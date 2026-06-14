import fs from "fs";
import path from "path";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import webpush from "web-push";
import OpenAI from "openai";
import {
  buildRashomonSystemPrompt,
  buildRashomonUserInput,
  RASHOMON_FALLBACKS,
  RASHOMON_NORMAL_GOAL,
  RASHOMON_RUPTURE_GOAL
} from "./rashomon_prompt.js";

dotenv.config();

const PORT = process.env.PORT || 3000;
const ALLOWED_MODELS = new Set(["gpt-5-mini"]);

const app = express();
const privateConfig = loadPrivateConfig();
const subscriptions = new Map();
const intervals = new Map();
const timeouts = new Map();
const activeSessions = new Set();
const RASHOMON_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "reply",
    "goalText",
    "memorySummary",
    "userTheory",
    "userBeliefs",
    "userSuspicions",
    "sharedClues",
    "pressurePoints",
    "woodcutterAdmissions",
    "woodcutterEvasions",
    "distortionCandidates",
    "distortionPlan",
    "shouldSuggestTheory",
    "shouldEnd"
  ],
  properties: {
    reply: { type: "string", maxLength: 420 },
    goalText: { type: "string", maxLength: 120 },
    memorySummary: { type: "string", maxLength: 700 },
    userTheory: { type: "string", maxLength: 260 },
    userBeliefs: { type: "array", maxItems: 4, items: { type: "string", maxLength: 90 } },
    userSuspicions: { type: "array", maxItems: 4, items: { type: "string", maxLength: 90 } },
    sharedClues: { type: "array", maxItems: 5, items: { type: "string", maxLength: 90 } },
    pressurePoints: { type: "array", maxItems: 4, items: { type: "string", maxLength: 90 } },
    woodcutterAdmissions: { type: "array", maxItems: 4, items: { type: "string", maxLength: 90 } },
    woodcutterEvasions: { type: "array", maxItems: 4, items: { type: "string", maxLength: 90 } },
    distortionCandidates: { type: "array", maxItems: 4, items: { type: "string", maxLength: 90 } },
    distortionPlan: { type: "array", maxItems: 4, items: { type: "string", maxLength: 90 } },
    shouldSuggestTheory: { type: "boolean" },
    shouldEnd: { type: "boolean" }
  }
};
const corsOptions = {
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) return callback(null, true);
    return callback(new Error("CORS origin not allowed"));
  },
  credentials: false
};

app.use(express.json({ limit: "1mb" }));
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

configureWebPush();

app.get("/", (req, res) => {
  res.json({ ok: true, service: "tamagotchi-exhibition-server" });
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    openaiReady: Boolean(privateConfig.openaiApiKey),
    pushReady: hasVapidKeys(),
    allowedOrigins: privateConfig.allowedOrigins
  });
});

app.get("/vapid-public-key", (req, res) => {
  res.json({ publicKey: privateConfig.vapidPublicKey || "" });
});

app.post("/subscribe", (req, res) => {
  const { userId, subscription } = req.body || {};
  if (!userId || !subscription) {
    return res.status(400).json({ ok: false, error: "userId and subscription required" });
  }
  if (!hasVapidKeys()) {
    return res.status(503).json({ ok: false, error: "web push is not configured" });
  }
  subscriptions.set(cleanText(userId, 120), subscription);
  res.json({ ok: true });
});

app.post("/start", async (req, res) => {
  const { userId, intervalSeconds = 30 } = req.body || {};
  const id = cleanText(userId, 120);
  if (!id) return res.status(400).json({ ok: false, error: "userId required" });
  if (!hasVapidKeys()) return res.status(503).json({ ok: false, error: "web push is not configured" });
  if (!subscriptions.has(id)) return res.status(404).json({ ok: false, error: "subscription not found" });

  stopUser(id);
  const seconds = Math.max(10, Number(intervalSeconds) || 30);
  await sendToUser(id, "이제 내가 가끔 부탁할게!");
  intervals.set(id, setInterval(() => sendToUser(id), seconds * 1000));
  res.json({ ok: true, intervalSeconds: seconds });
});

app.post("/stop", (req, res) => {
  const id = cleanText(req.body?.userId, 120);
  if (!id) return res.status(400).json({ ok: false, error: "userId required" });
  stopUser(id);
  res.json({ ok: true });
});

app.post("/rupture-after", (req, res) => {
  const id = cleanText(req.body?.userId, 120);
  const seconds = Math.max(1, Number(req.body?.seconds) || 30);
  if (!id) return res.status(400).json({ ok: false, error: "userId required" });

  if (timeouts.has(id)) clearTimeout(timeouts.get(id));
  const timer = setTimeout(async () => {
    stopUser(id);
    if (hasVapidKeys()) await sendToUser(id, "...");
  }, seconds * 1000);
  timeouts.set(id, timer);
  res.json({ ok: true, seconds });
});

app.post("/send-test", async (req, res) => {
  const id = cleanText(req.body?.userId, 120);
  if (!id) return res.status(400).json({ ok: false, error: "userId required" });
  if (!hasVapidKeys()) return res.status(503).json({ ok: false, error: "web push is not configured" });
  const result = await sendToUser(id, cleanText(req.body?.body, 160) || "테스트 알림이야!");
  res.json(result);
});

app.post("/api/rashomon/chat", async (req, res) => {
  const body = req.body || {};
  const sessionId = cleanText(body.sessionId, 120) || "anonymous";
  const sessionKey = `rashomon:${sessionId}`;
  const phase = body.phase === "rupture" ? "rupture" : "normal";
  const message = cleanText(body.message, 300);
  const requestedModel = cleanText(body.model, 80);
  const model = ALLOWED_MODELS.has(requestedModel) ? requestedModel : privateConfig.openaiModel;
  const memorySummary = cleanText(body.memorySummary, 1200);
  const recentMessages = sanitizeRashomonRecentMessages(body.recentMessages);
  const rashomonMemory = sanitizeRashomonMemory(body.rashomonMemory);
  const turnCount = clampNumber(body.turnCount, 0, 50);
  const maxTurns = clampNumber(body.maxTurns, 1, 50) || 10;
  const requestedMaxOutputTokens = Number(body.maxOutputTokens);
  const maxOutputTokens = Number.isFinite(requestedMaxOutputTokens)
    ? clampNumber(requestedMaxOutputTokens, 1600, 4000)
    : 3000;

  if (!message) {
    return res.status(400).json(makeRashomonFallback({
      phase,
      memorySummary,
      rashomonMemory,
      turnCount,
      maxTurns,
      fallbackType: "validationError",
      errorHint: "message is empty",
      replyOverride: "조금만 더 분명히 물어봐 주시겠습니까. 숲의 일은 말이 흐려지기 쉽습니다."
    }));
  }

  if (activeSessions.has(sessionKey)) {
    return res.status(429).json(makeRashomonFallback({
      phase,
      memorySummary,
      rashomonMemory,
      turnCount,
      maxTurns,
      fallbackType: "validationError",
      errorHint: "active session already processing",
      replyOverride: "잠시만요. 방금 물은 말을 아직 되짚고 있습니다."
    }));
  }

  activeSessions.add(sessionKey);

  try {
    const result = await generateRashomonReply({
      phase,
      message,
      model,
      memorySummary,
      recentMessages,
      rashomonMemory,
      turnCount,
      maxTurns,
      maxOutputTokens
    });
    res.json(result);
  } catch (err) {
    console.warn("[rashomon fallback: unknown]", safeErrorHint(err));
    res.json(makeRashomonFallback({
      phase,
      memorySummary,
      rashomonMemory,
      turnCount,
      maxTurns,
      fallbackType: "unknown",
      errorHint: safeErrorHint(err)
    }));
  } finally {
    activeSessions.delete(sessionKey);
  }
});

app.use((err, req, res, next) => {
  if (err && err.message === "CORS origin not allowed") {
    return res.status(403).json({ ok: false, error: "origin not allowed" });
  }
  console.error(err);
  res.status(500).json({ ok: false, error: "server error" });
});

app.listen(PORT, () => {
  console.log(`Tamagotchi exhibition server listening on ${PORT}`);
});

function loadPrivateConfig() {
  const candidates = [
    "/etc/secrets/private_config.txt",
    path.join(process.cwd(), "private_config.txt"),
    path.join(process.cwd(), "server", "private_config.txt"),
    path.join(process.cwd(), "app", "render_server", "private_config.txt")
  ];

  let fileConfig = {};

  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) {
      try {
        fileConfig = JSON.parse(fs.readFileSync(filePath, "utf8"));
        console.log("Loaded private config from", filePath);
        break;
      } catch (err) {
        console.warn("Failed to parse private_config.txt:", err.message);
      }
    }
  }

  const allowedOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS, fileConfig.server?.allowedOrigins);
  const allowedOrigin = process.env.ALLOWED_ORIGIN || fileConfig.server?.allowedOrigin || "https://tamagotchi68.netlify.app";
  if (!allowedOrigins.includes(allowedOrigin)) allowedOrigins.push(allowedOrigin);

  return {
    openaiApiKey: process.env.OPENAI_API_KEY || fileConfig.openai?.apiKey || "",
    openaiModel: process.env.OPENAI_MODEL || fileConfig.openai?.model || "gpt-5-mini",
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY || fileConfig.vapid?.publicKey || "",
    vapidPrivateKey: process.env.VAPID_PRIVATE_KEY || fileConfig.vapid?.privateKey || "",
    vapidSubject: process.env.VAPID_SUBJECT || fileConfig.vapid?.subject || "",
    allowedOrigin,
    allowedOrigins
  };
}

function parseAllowedOrigins(envValue, fileValue) {
  const origins = [];
  if (Array.isArray(fileValue)) origins.push(...fileValue);
  if (typeof fileValue === "string") origins.push(fileValue);
  if (envValue) origins.push(...envValue.split(",").map((item) => item.trim()).filter(Boolean));
  origins.push("http://localhost:3000", "http://localhost:4173", "http://127.0.0.1:4173");
  return [...new Set(origins.filter(Boolean))];
}

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (privateConfig.allowedOrigins.includes("*")) return true;
  if (privateConfig.allowedOrigins.includes(origin)) return true;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function configureWebPush() {
  if (!hasVapidKeys()) {
    console.warn("[web-push] VAPID keys are missing. Push endpoints stay disabled.");
    return;
  }
  webpush.setVapidDetails(
    privateConfig.vapidSubject || "mailto:example@example.com",
    privateConfig.vapidPublicKey,
    privateConfig.vapidPrivateKey
  );
}

function hasVapidKeys() {
  return Boolean(privateConfig.vapidPublicKey && privateConfig.vapidPrivateKey);
}

async function sendToUser(userId, body = "TAMAGOTCHI가 부르고 있습니다.") {
  const subscription = subscriptions.get(userId);
  if (!subscription) return { ok: false, reason: "no subscription" };

  const payload = JSON.stringify({
    title: "삐삐…",
    body,
    url: "/"
  });

  try {
    await webpush.sendNotification(subscription, payload);
    return { ok: true };
  } catch (err) {
    console.error("[push failed]", userId, err.statusCode || "", err.message);
    if (err.statusCode === 404 || err.statusCode === 410) {
      subscriptions.delete(userId);
      stopUser(userId);
    }
    return { ok: false, reason: err.message };
  }
}

function stopUser(userId) {
  if (intervals.has(userId)) {
    clearInterval(intervals.get(userId));
    intervals.delete(userId);
  }
  if (timeouts.has(userId)) {
    clearTimeout(timeouts.get(userId));
    timeouts.delete(userId);
  }
}

function extractResponsesText(response) {
  const output = Array.isArray(response.output) ? response.output : [];
  return output
    .flatMap((item) => Array.isArray(item.content) ? item.content : [])
    .map((content) => content.text || "")
    .filter(Boolean)
    .join("\n");
}

async function generateRashomonReply({
  phase,
  message,
  model,
  memorySummary,
  recentMessages,
  rashomonMemory,
  turnCount,
  maxTurns,
  maxOutputTokens
}) {
  if (!privateConfig.openaiApiKey) {
    return makeRashomonFallback({
      phase,
      memorySummary,
      rashomonMemory,
      turnCount,
      maxTurns,
      fallbackType: "openaiError",
      errorHint: "OpenAI API key is not configured"
    });
  }

  const client = new OpenAI({ apiKey: privateConfig.openaiApiKey });
  const instructions = buildRashomonSystemPrompt({
    phase,
    memorySummary,
    rashomonMemory,
    turnCount,
    maxTurns
  });
  const input = buildRashomonUserInput({ phase, message, recentMessages });
  let rawText = "";
  let responseStatus = "";
  let incompleteReason = "";

  try {
    if (client.responses?.create) {
      const response = await client.responses.create({
        model,
        instructions,
        input,
        max_output_tokens: maxOutputTokens,
        reasoning: { effort: "minimal" },
        text: {
          format: {
            type: "json_schema",
            name: "rashomon_response",
            strict: true,
            schema: RASHOMON_RESPONSE_SCHEMA
          }
        }
      });
      responseStatus = cleanText(response.status, 80);
      incompleteReason = cleanText(response.incomplete_details?.reason, 120);
      if (responseStatus === "incomplete") {
        console.warn("[rashomon fallback: incomplete]", incompleteReason || "response status incomplete");
        return makeRashomonFallback({
          phase,
          memorySummary,
          rashomonMemory,
          turnCount,
          maxTurns,
          fallbackType: "incomplete",
          errorHint: incompleteReason || "OpenAI response status was incomplete"
        });
      }
      rawText = response.output_text || extractResponsesText(response);
    } else {
      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: instructions },
          { role: "user", content: input }
        ],
        max_tokens: maxOutputTokens,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "rashomon_response",
            strict: true,
            schema: RASHOMON_RESPONSE_SCHEMA
          }
        }
      });
      rawText = response.choices?.[0]?.message?.content || "";
      const finishReason = cleanText(response.choices?.[0]?.finish_reason, 80);
      if (finishReason === "length") {
        console.warn("[rashomon fallback: incomplete]", "chat completion finish_reason=length");
        return makeRashomonFallback({
          phase,
          memorySummary,
          rashomonMemory,
          turnCount,
          maxTurns,
          fallbackType: "incomplete",
          errorHint: "OpenAI chat completion stopped because of length"
        });
      }
    }
  } catch (err) {
    const errorHint = safeErrorHint(err);
    console.warn("[rashomon fallback: openaiError]", errorHint);
    return makeRashomonFallback({
      phase,
      memorySummary,
      rashomonMemory,
      turnCount,
      maxTurns,
      fallbackType: "openaiError",
      errorHint
    });
  }

  if (!rawText) {
    console.warn("[rashomon fallback: noText]", `status=${responseStatus || "unknown"}`);
    return makeRashomonFallback({
      phase,
      memorySummary,
      rashomonMemory,
      turnCount,
      maxTurns,
      fallbackType: "noText",
      errorHint: `OpenAI returned empty text. status=${responseStatus || "unknown"}`
    });
  }

  const parsed = parseJsonObject(rawText);
  if (!parsed) {
    const errorHint = `rawText length=${rawText.length}; sample=${rawText.slice(0, 300)}`;
    console.warn("[rashomon fallback: parseError]", errorHint);
    return makeRashomonFallback({
      phase,
      memorySummary,
      rashomonMemory,
      turnCount,
      maxTurns,
      fallbackType: "parseError",
      errorHint
    });
  }

  const validationError = validateRashomonResponse(parsed);
  if (validationError) {
    console.warn("[rashomon fallback: validationError]", validationError);
    return makeRashomonFallback({
      phase,
      memorySummary,
      rashomonMemory,
      turnCount,
      maxTurns,
      fallbackType: "validationError",
      errorHint: validationError
    });
  }

  return normalizeRashomonResult(parsed, {
    phase,
    memorySummary,
    rashomonMemory,
    turnCount,
    maxTurns
  });
}

function normalizeRashomonResult(value, context) {
  const fallback = makeRashomonFallback(context);
  const source = value && typeof value === "object" ? value : {};
  const result = { ...fallback };

  result.reply = cleanText(source.reply, 700) || fallback.reply;
  result.goalText = cleanText(source.goalText, 180) || fallback.goalText;
  result.memorySummary = cleanText(source.memorySummary, 1200) || fallback.memorySummary;
  result.userTheory = cleanText(source.userTheory, 600) || fallback.userTheory;
  result.userBeliefs = cleanTextArray(source.userBeliefs, fallback.userBeliefs, 8, 180);
  result.userSuspicions = cleanTextArray(source.userSuspicions, fallback.userSuspicions, 8, 180);
  result.sharedClues = cleanTextArray(source.sharedClues, fallback.sharedClues, 10, 180);
  result.pressurePoints = cleanTextArray(source.pressurePoints, fallback.pressurePoints, 8, 180);
  result.woodcutterAdmissions = cleanTextArray(source.woodcutterAdmissions, fallback.woodcutterAdmissions, 8, 180);
  result.woodcutterEvasions = cleanTextArray(source.woodcutterEvasions, fallback.woodcutterEvasions, 8, 180);
  result.distortionCandidates = cleanTextArray(source.distortionCandidates, fallback.distortionCandidates, 8, 180);
  result.distortionPlan = cleanTextArray(source.distortionPlan, fallback.distortionPlan, 8, 180);
  result.shouldSuggestTheory = source.shouldSuggestTheory === undefined ? fallback.shouldSuggestTheory : Boolean(source.shouldSuggestTheory);
  result.shouldEnd = Boolean(source.shouldEnd) || (context.phase === "normal" && context.turnCount >= context.maxTurns);

  if (context.phase === "normal" && context.turnCount >= context.maxTurns && !source.reply) {
    result.reply = RASHOMON_FALLBACKS.ending;
  }

  result.fallback = false;
  result.fallbackType = "";
  result.errorHint = "";
  return result;
}

function makeRashomonFallback({
  phase,
  memorySummary,
  rashomonMemory,
  turnCount,
  maxTurns,
  fallbackType,
  errorHint,
  replyOverride
}) {
  const isRupture = phase === "rupture";
  const shouldEnd = !isRupture && turnCount >= maxTurns;
  let reply = isRupture ? RASHOMON_FALLBACKS.rupture : RASHOMON_FALLBACKS.normal;
  if (fallbackType === "openaiError" && errorHint === "OpenAI API key is not configured") reply = RASHOMON_FALLBACKS.missingKey;
  if (shouldEnd && !(fallbackType === "openaiError" && errorHint === "OpenAI API key is not configured")) reply = RASHOMON_FALLBACKS.ending;
  if (replyOverride) reply = replyOverride;

  return {
    fallback: true,
    fallbackType: cleanText(fallbackType || "unknown", 40),
    errorHint: cleanText(errorHint || "", 500),
    reply,
    goalText: isRupture ? RASHOMON_RUPTURE_GOAL : RASHOMON_NORMAL_GOAL,
    memorySummary: cleanText(memorySummary, 1200),
    userTheory: cleanText(rashomonMemory?.userTheory, 600),
    userBeliefs: cleanTextArray(rashomonMemory?.userBeliefs, [], 8, 180),
    userSuspicions: cleanTextArray(rashomonMemory?.userSuspicions, [], 8, 180),
    sharedClues: cleanTextArray(rashomonMemory?.sharedClues, [], 10, 180),
    pressurePoints: cleanTextArray(rashomonMemory?.pressurePoints, [], 8, 180),
    woodcutterAdmissions: cleanTextArray(rashomonMemory?.woodcutterAdmissions, [], 8, 180),
    woodcutterEvasions: cleanTextArray(rashomonMemory?.woodcutterEvasions, [], 8, 180),
    distortionCandidates: cleanTextArray(rashomonMemory?.distortionCandidates, [], 8, 180),
    distortionPlan: cleanTextArray(rashomonMemory?.distortionPlan, [], 8, 180),
    shouldSuggestTheory: !isRupture && turnCount >= Math.max(1, maxTurns - 3),
    shouldEnd
  };
}

function parseJsonObject(value) {
  const text = cleanText(value, 12000);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch (nestedErr) {
      return null;
    }
  }
}

function validateRashomonResponse(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "response is not an object";
  const allowedFields = new Set(Object.keys(RASHOMON_RESPONSE_SCHEMA.properties));
  for (const field of Object.keys(value)) {
    if (!allowedFields.has(field)) return `unexpected field: ${field}`;
  }
  for (const field of RASHOMON_RESPONSE_SCHEMA.required) {
    if (!(field in value)) return `missing required field: ${field}`;
  }
  for (const [field, schema] of Object.entries(RASHOMON_RESPONSE_SCHEMA.properties)) {
    const current = value[field];
    if (schema.type === "string" && typeof current !== "string") return `field ${field} must be string`;
    if (schema.type === "boolean" && typeof current !== "boolean") return `field ${field} must be boolean`;
    if (schema.type === "array" && (!Array.isArray(current) || current.some((item) => typeof item !== "string"))) {
      return `field ${field} must be string array`;
    }
  }
  return "";
}

function safeErrorHint(err) {
  if (!err) return "";
  const parts = [];
  if (err.status) parts.push(`status=${err.status}`);
  if (err.code) parts.push(`code=${cleanText(err.code, 80)}`);
  if (err.type) parts.push(`type=${cleanText(err.type, 80)}`);
  if (err.message) parts.push(`message=${cleanText(err.message, 260)}`);
  return parts.join("; ") || cleanText(String(err), 260);
}

function sanitizeRashomonRecentMessages(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-8).map((item) => {
    const role = item?.role === "assistant" || item?.role === "system" ? item.role : "user";
    return {
      role,
      text: cleanText(item?.text, 300)
    };
  }).filter((item) => item.text);
}

function sanitizeRashomonMemory(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    userTheory: cleanText(source.userTheory, 600),
    userBeliefs: cleanTextArray(source.userBeliefs, [], 8, 180),
    userSuspicions: cleanTextArray(source.userSuspicions, [], 8, 180),
    sharedClues: cleanTextArray(source.sharedClues, [], 10, 180),
    pressurePoints: cleanTextArray(source.pressurePoints, [], 8, 180),
    woodcutterAdmissions: cleanTextArray(source.woodcutterAdmissions, [], 8, 180),
    woodcutterEvasions: cleanTextArray(source.woodcutterEvasions, [], 8, 180),
    distortionCandidates: cleanTextArray(source.distortionCandidates, [], 8, 180),
    distortionPlan: cleanTextArray(source.distortionPlan, [], 8, 180),
    lastGoal: cleanText(source.lastGoal, 180),
    lastPhase: source.lastPhase === "rupture" ? "rupture" : "normal"
  };
}

function cleanTextArray(value, fallback = [], maxItems = 8, maxLength = 180) {
  const source = Array.isArray(value) ? value : fallback;
  return source.map((item) => cleanText(item, maxLength)).filter(Boolean).slice(0, maxItems);
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function cleanText(value, maxLength) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim().slice(0, maxLength);
}
