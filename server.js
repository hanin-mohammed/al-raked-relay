const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const HOST = process.env.AL_RAKED_DISPLAY_HOST || "0.0.0.0";
const PORT = Number(process.env.AL_RAKED_DISPLAY_PORT || 4173);
const FEED_KEY = process.env.AL_RAKED_FEED_KEY || "local-proof-of-concept";
const PUBLIC_DIR = path.join(__dirname, "public");
const MAX_ENTRIES = 10;
const MAX_BODY_BYTES = 32 * 1024;

const entries = [];
const clients = new Set();

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(value));
}

function cleanText(value, maximumLength = 120) {
  return String(value ?? "").trim().slice(0, maximumLength);
}

function normalizePrice(value) {
  const text = cleanText(value, 30);
  if (!text) return "-";
  if (/^free$/i.test(text)) return "Free";

  const numeric = Number(text.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(numeric)
    ? numeric.toLocaleString("en-AE", { maximumFractionDigits: 2 })
    : text;
}

function normalizeTimestamp(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function normalizeEntry(input) {
  return {
    id: cleanText(input.id, 100) || `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    timestamp: normalizeTimestamp(input.timestamp),
    foreman: cleanText(input.foreman) || "-",
    employee: cleanText(input.employee) || "-",
    licensePlate: cleanText(input.licensePlate, 40) || "-",
    service: cleanText(input.service) || "-",
    company: cleanText(input.company) || "-",
    price: normalizePrice(input.price),
  };
}

function broadcast(eventName, payload) {
  const packet = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients) client.write(packet);
}

function receiveJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });

    request.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });
    request.on("error", reject);
  });
}

function serveFile(response, pathname) {
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const requestedPath = path.resolve(PUBLIC_DIR, relativePath);

  if (!requestedPath.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    sendJson(response, 403, { error: "Forbidden" });
    return;
  }

  fs.readFile(requestedPath, (error, data) => {
    if (error) {
      sendJson(response, error.code === "ENOENT" ? 404 : 500, { error: "Not found" });
      return;
    }

    response.writeHead(200, {
      "Content-Type": contentTypes[path.extname(requestedPath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(data);
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { ok: true, entries: entries.length, viewers: clients.size });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/entries") {
    sendJson(response, 200, { entries });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/stream") {
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.write(`event: snapshot\ndata: ${JSON.stringify({ entries })}\n\n`);
    clients.add(response);
    const disconnect = () => clients.delete(response);
    request.on("close", disconnect);
    response.on("close", disconnect);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/entries") {
    if (request.headers["x-al-raked-feed-key"] !== FEED_KEY) {
      sendJson(response, 401, { error: "Invalid feed key" });
      return;
    }

    try {
      const entry = normalizeEntry(await receiveJson(request));
      entries.unshift(entry);
      entries.splice(MAX_ENTRIES);
      broadcast("entry", { entry, entries });
      sendJson(response, 201, { ok: true, entry, retained: entries.length });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return;
  }

  if (request.method === "GET") {
    serveFile(response, url.pathname);
    return;
  }

  sendJson(response, 405, { error: "Method not allowed" });
});

server.listen(PORT, HOST, () => {
  console.log(`Al Raked Live Display: http://localhost:${PORT}`);
  console.log(`Listening on ${HOST}:${PORT}`);
});

function shutdown() {
  for (const client of clients) client.end();
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
