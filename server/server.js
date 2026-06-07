import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import webpush from "web-push";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json({ limit: "1mb" }));

if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
  console.warn("[경고] VAPID 키가 없습니다. npm run keys로 생성 후 .env에 입력하세요.");
} else {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:test@example.com",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

const subscriptions = new Map(); // userId -> subscription
const intervals = new Map();     // userId -> timer
const timeouts = new Map();      // userId -> timer

const messages = [
  "배고파… 먹이 좀 줄래?",
  "나 좀 쓰다듬어 줄래?",
  "같이 있어주면 기분이 좋아질 것 같아!",
  "꼬르륵… 지금 조금 배고파!"
];

function randomMessage() {
  return messages[Math.floor(Math.random() * messages.length)];
}

async function sendToUser(userId, body = randomMessage()) {
  const subscription = subscriptions.get(userId);
  if (!subscription) return { ok: false, reason: "no subscription" };

  const payload = JSON.stringify({
    title: "동행 다마고치",
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

app.get("/", (req, res) => {
  res.json({ ok: true, service: "tamagotchi-push-server" });
});

app.get("/vapid-public-key", (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || "" });
});

app.post("/subscribe", (req, res) => {
  const { userId, subscription } = req.body || {};
  if (!userId || !subscription) return res.status(400).json({ ok: false, error: "userId and subscription required" });

  subscriptions.set(userId, subscription);
  console.log("[subscribe]", userId, "total:", subscriptions.size);
  res.json({ ok: true });
});

app.post("/start", async (req, res) => {
  const { userId, intervalSeconds = 30 } = req.body || {};
  if (!userId) return res.status(400).json({ ok: false, error: "userId required" });
  if (!subscriptions.has(userId)) return res.status(404).json({ ok: false, error: "subscription not found" });

  stopUser(userId);

  const seconds = Math.max(10, Number(intervalSeconds) || 30);
  await sendToUser(userId, "이제 내가 가끔 부탁할게!");
  const timer = setInterval(() => sendToUser(userId), seconds * 1000);
  intervals.set(userId, timer);

  console.log("[start]", userId, seconds);
  res.json({ ok: true, intervalSeconds: seconds });
});

app.post("/stop", (req, res) => {
  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ ok: false, error: "userId required" });

  stopUser(userId);
  console.log("[stop]", userId);
  res.json({ ok: true });
});

app.post("/rupture-after", (req, res) => {
  const { userId, seconds = 30 } = req.body || {};
  if (!userId) return res.status(400).json({ ok: false, error: "userId required" });

  const delay = Math.max(1, Number(seconds) || 30);
  if (timeouts.has(userId)) clearTimeout(timeouts.get(userId));

  const timer = setTimeout(async () => {
    stopUser(userId);
    await sendToUser(userId, "...");
    console.log("[rupture]", userId);
  }, delay * 1000);

  timeouts.set(userId, timer);
  console.log("[rupture-after]", userId, delay);
  res.json({ ok: true, seconds: delay });
});

app.post("/send-test", async (req, res) => {
  const { userId, body } = req.body || {};
  if (!userId) return res.status(400).json({ ok: false, error: "userId required" });
  const result = await sendToUser(userId, body || "테스트 알림이야!");
  res.json(result);
});

app.listen(PORT, () => {
  console.log(`Tamagotchi push server listening on ${PORT}`);
});
