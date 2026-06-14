const fs = require("fs");
const http = require("http");
const path = require("path");

const root = path.resolve(process.argv[2] || ".");
const port = Number(process.argv[3] || 4174);

http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const rel = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
  const file = path.resolve(root, rel);

  if (!file.startsWith(root)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": file.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream"
    });
    res.end(data);
  });
}).listen(port, "127.0.0.1");
