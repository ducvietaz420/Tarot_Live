import { config as loadEnv } from "dotenv";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFile, mkdir, writeFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, dirname, extname, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { Engine } from "./engine.ts";
import { Store } from "./store.ts";
import {
  TikFinityAdapter,
  DEFAULT_TIKFINITY_URL,
  validateTikFinityURL,
} from "./tikfinity.ts";
import { synthesize } from "./providers.ts";
import type { Action, Mode } from "../shared/types.ts";
import { speechPages } from "../shared/text.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: resolve(root, "backend/.env"), quiet: true });
const port = Number(process.env.PORT || 3210);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("PORT phải là 1024–65535.");
const origin = `http://127.0.0.1:${port}`;
const allowedOrigins = new Set([origin, `http://localhost:${port}`]);
const production = process.argv.includes("--production");
const databasePath = resolve(
  root,
  process.env.DATA_PATH || "data/tarot.sqlite",
);
const storageDir = dirname(databasePath);
const engine = new Engine(new Store(databasePath));
let tikfinityURL = process.env.TIKFINITY_URL || DEFAULT_TIKFINITY_URL;
if (!process.env.TIKFINITY_URL)
  try {
    const saved = JSON.parse(
      await readFile(resolve(storageDir, "connection.json"), "utf8"),
    );
    if (typeof saved.url === "string")
      tikfinityURL = validateTikFinityURL(saved.url);
  } catch {}
if (!validateTikFinityURL(tikfinityURL))
  throw new Error("TIKFINITY_URL không hợp lệ.");
const adapter = new TikFinityAdapter(
  tikfinityURL,
  (e) => engine.ingest(e, "live"),
  (status) => engine.setConnection(status),
);
engine.onReconnect = () => adapter.reconnect(tikfinityURL);
const peers = new Map<WebSocket, { mode: Mode; id: string; alive: boolean }>();
const ttsRequests = new Map<string, Promise<{ url: string; text: string }>>();
const wss = new WebSocketServer({ noServer: true, maxPayload: 16_384 });
const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".json": "application/json; charset=utf-8",
};
function send(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value));
}
function validOrigin(req: IncomingMessage) {
  return !req.headers.origin || allowedOrigins.has(req.headers.origin);
}
function validHost(req: IncomingMessage) {
  return [`127.0.0.1:${port}`, `localhost:${port}`].includes(
    req.headers.host || "",
  );
}
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let text = "";
  for await (const chunk of req) {
    text += chunk.toString();
    if (Buffer.byteLength(text) > 128_000)
      throw new Error("Dữ liệu vượt 128 KB.");
  }
  const data = JSON.parse(text || "{}");
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("JSON object không hợp lệ.");
  return data;
}
let vite:
  | Awaited<ReturnType<(typeof import("vite"))["createServer"]>>
  | undefined;
if (!production) {
  const { createServer: createVite } = await import("vite");
  vite = await createVite({
    root,
    server: {
      middlewareMode: true,
      host: "127.0.0.1",
      hmr: false,
      fs: {
        deny: [
          ".env",
          ".env.*",
          "**/.env",
          "**/.env.*",
          "*.{crt,pem}",
          "**/.git/**",
          "**/data/**",
          "**/backend/**",
          "**/server/**",
          "**/*.sqlite*",
        ],
      },
    },
    appType: "spa",
  });
}
const server = createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  if (!validHost(req) || !validOrigin(req)) {
    send(res, 403, { error: "Host/Origin không được phép." });
    return;
  }
  let url: URL;
  try {
    url = new URL(req.url || "/", origin);
  } catch {
    send(res, 400, { error: "URL không hợp lệ." });
    return;
  }
  const mode: Mode = url.searchParams.get("mode") === "live" ? "live" : "demo";
  try {
    if (url.pathname === "/api/state" && req.method === "GET") {
      send(res, 200, engine.snapshot(mode));
      return;
    }
    if (url.pathname === "/api/config/export" && req.method === "GET") {
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="tiem-tarot-config.json"',
      );
      send(res, 200, engine.config);
      return;
    }
    if (url.pathname === "/api/action" && req.method === "POST") {
      const action = (await body(req)) as Action;
      if (typeof action.type !== "string")
        throw new Error("Thiếu loại thao tác.");
      if (action.type === "connection-config") {
        if (typeof action.url !== "string" || !validateTikFinityURL(action.url))
          throw new Error("URL TikFinity cần ws:// hoặc wss:// hợp lệ.");
        tikfinityURL = action.url;
        adapter.reconnect(tikfinityURL);
        // Persist the URL separately from exported configuration; never contains a secret.
        await mkdir(storageDir, { recursive: true });
        await writeFile(
          resolve(storageDir, "connection.json"),
          JSON.stringify({ url: tikfinityURL }),
        );
        send(res, 200, engine.snapshot(mode));
        return;
      }
      send(res, 200, engine.action(action, mode));
      return;
    }
    if (url.pathname === "/api/history" && req.method === "GET") {
      send(res, 200, engine.history(mode));
      return;
    }
    if (url.pathname.startsWith("/api/history/") && req.method === "GET") {
      const data = engine.archived(
        Number(url.pathname.slice("/api/history/".length)),
      );
      send(res, data ? 200 : 404, data || { error: "Không có phiên này." });
      return;
    }
    if (url.pathname === "/api/tts" && req.method === "POST") {
      const b = await body(req);
      const a = engine.sessions[mode].active;
      const clientId = req.headers["x-audio-client"];
      if (
        typeof clientId !== "string" ||
        engine.audioOwners[mode] !== clientId
      ) {
        send(res, 409, { error: "Tab này không sở hữu nguồn âm thanh." });
        return;
      }
      if (
        !a ||
        a.paused ||
        a.id !== b.readingId ||
        a.phase !== b.phase ||
        a.generation !== b.generation
      ) {
        send(res, 409, { error: "Lượt/bước đã thay đổi." });
        return;
      }
      if (a.config.ttsProvider !== "http")
        throw new Error("Chưa chọn TTS HTTP cho lượt này.");
      const signature = `${a.id}:${a.phase}:${a.generation}`;
      const pages = speechPages(engine.currentText(mode));
      const segmentIndex = b.segmentIndex;
      if (
        segmentIndex !== undefined &&
        (typeof segmentIndex !== "number" ||
          !Number.isInteger(segmentIndex) ||
          !pages[segmentIndex])
      )
        throw new Error("Đoạn đọc không hợp lệ.");
      const segmentText =
        typeof segmentIndex === "number"
          ? pages[segmentIndex]
          : engine.currentText(mode);
      const cacheKey = signature + `:${segmentIndex ?? "full"}`;
      let task = ttsRequests.get(cacheKey);
      if (!task) {
        engine.audioWait(mode, signature, true);
        task = (async () => {
          try {
            const result = await synthesize(
              a,
              engine.signal(mode),
              segmentText,
            );
            const current = engine.sessions[mode].active;
            if (
              !current ||
              current.paused ||
              `${current.id}:${current.phase}:${current.generation}` !==
                signature
            )
              throw new Error("Lượt/bước đã thay đổi; đã bỏ audio cũ.");
            const ext =
              result.mime === "audio/wav"
                ? ".wav"
                : result.mime === "audio/ogg"
                  ? ".ogg"
                  : result.mime === "audio/webm"
                    ? ".webm"
                    : ".mp3";
            const filename =
              createHash("sha256").update(cacheKey).digest("hex") + ext;
            await mkdir(resolve(storageDir, "audio"), { recursive: true });
            await writeFile(
              resolve(storageDir, "audio", filename),
              result.bytes,
            );
            return { url: `/audio/${filename}`, text: segmentText };
          } finally {
            engine.audioWait(mode, signature, false);
          }
        })();
        ttsRequests.set(cacheKey, task);
        if (ttsRequests.size > 200)
          ttsRequests.delete(ttsRequests.keys().next().value!);
      }
      const result = await task;
      const current = engine.sessions[mode].active;
      if (engine.audioOwners[mode] !== clientId) {
        send(res, 409, { error: "Tab này không còn sở hữu nguồn âm thanh." });
        return;
      }
      if (
        !current ||
        current.paused ||
        `${current.id}:${current.phase}:${current.generation}` !== signature
      ) {
        send(res, 409, { error: "Lượt/bước đã thay đổi; đã bỏ audio cũ." });
        return;
      }
      send(res, 200, result);
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      send(res, 404, { error: "API không tồn tại." });
      return;
    }
    if (url.pathname.startsWith("/audio/")) {
      const filename = url.pathname.slice("/audio/".length);
      if (!/^[\da-f]{64}\.(?:mp3|wav|ogg|webm)$/u.test(filename)) {
        send(res, 404, { error: "Không có audio này." });
        return;
      }
      const bytes = await readFile(resolve(storageDir, "audio", filename));
      res.writeHead(200, {
        "Content-Type": mime[extname(filename)] || "audio/mpeg",
        "Cache-Control": "private, max-age=3600",
      });
      res.end(bytes);
      return;
    }
    if (!production && vite) {
      vite.middlewares(req, res, () => {
        send(res, 404, { error: "Không tìm thấy trang." });
      });
      return;
    }
    const dist = resolve(root, "dist");
    const pathname = decodeURIComponent(url.pathname);
    let file = resolve(dist, "." + pathname);
    if (!file.startsWith(dist + sep) && file !== dist) {
      send(res, 403, { error: "Đường dẫn không hợp lệ." });
      return;
    }
    try {
      if (!(await stat(file)).isFile()) file = resolve(dist, "index.html");
    } catch {
      file = extname(pathname) ? file : resolve(dist, "index.html");
    }
    const bytes = await readFile(file);
    res.writeHead(200, {
      "Content-Type": mime[extname(file)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(bytes);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Yêu cầu không hợp lệ.";
    const safe = message.startsWith("ENOENT")
      ? "Không tìm thấy file."
      : message.startsWith("Unexpected")
        ? "JSON không hợp lệ."
        : message.includes("aborted")
          ? "Tác vụ đã dừng."
          : message;
    if (!res.headersSent)
      send(res, message.startsWith("ENOENT") ? 404 : 400, {
        error: safe.slice(0, 300),
      });
    else res.end();
  }
});
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url || "/", origin);
  if (url.pathname !== "/ws" || !validHost(req) || !validOrigin(req)) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});
wss.on("connection", (ws, req) => {
  const url = new URL(req.url || "/", origin);
  const mode: Mode = url.searchParams.get("mode") === "live" ? "live" : "demo";
  const requested = url.searchParams.get("clientId");
  const id =
    requested && /^[\w-]{8,100}$/u.test(requested) ? requested : randomUUID();
  if (Array.from(peers.values()).some((p) => p.id === id)) {
    ws.close(1008, "Mỗi tab cần một clientId riêng.");
    return;
  }
  peers.set(ws, { mode, id, alive: true });
  ws.send(JSON.stringify(engine.snapshot(mode)));
  ws.on("pong", () => {
    const p = peers.get(ws);
    if (p) p.alive = true;
  });
  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === "audio-claim") {
        engine.setAudioOwner(mode, id, msg.transfer === true);
      } else if (
        msg.type === "audio-release" &&
        engine.audioOwners[mode] === id
      ) {
        engine.setAudioOwner(mode, null);
      } else if (
        msg.type === "audio-status" &&
        engine.audioOwners[mode] === id
      ) {
        engine.setAudioStatus(mode, String(msg.status || ""));
      } else if (
        msg.type === "audio-segment" &&
        engine.audioOwners[mode] === id
      ) {
        engine.setAudioSegment(mode, msg);
      } else if (
        msg.type === "audio-progress" &&
        engine.audioOwners[mode] === id
      ) {
        engine.audioProgress(mode, msg);
      } else if (
        msg.type === "audio-start" &&
        engine.audioOwners[mode] === id
      ) {
        engine.audioStart(mode, msg.readingId, msg.phase, msg.generation);
      } else if (
        msg.type === "audio-heartbeat" &&
        engine.audioOwners[mode] === id
      ) {
        engine.audioHeartbeat(mode, msg.readingId, msg.phase, msg.generation);
      } else if (
        msg.type === "audio-error" &&
        engine.audioOwners[mode] === id
      ) {
        engine.audioError(mode, msg.readingId, msg.phase, msg.generation);
      } else if (
        msg.type === "audio-duration" &&
        engine.audioOwners[mode] === id
      ) {
        engine.audioDuration(
          mode,
          msg.readingId,
          msg.phase,
          msg.generation,
          msg.seconds,
        );
      } else if (msg.type === "audio-done" && engine.audioOwners[mode] === id) {
        engine.audioDone(mode, msg.readingId, msg.phase, msg.generation);
      }
    } catch {
      /* invalid WS command has no effects */
    }
  });
  ws.on("close", () => {
    peers.delete(ws);
    if (
      engine.audioOwners[mode] === id &&
      !Array.from(peers.values()).some((p) => p.mode === mode && p.id === id)
    )
      engine.setAudioOwner(mode, null);
  });
  ws.on("error", () => {});
});
engine.onChange = (mode) => {
  for (const [ws, p] of peers)
    if (ws.readyState === WebSocket.OPEN && (!mode || p.mode === mode)) {
      if (ws.bufferedAmount > 2e6) {
        ws.terminate();
        continue;
      }
      ws.send(JSON.stringify(engine.snapshot(p.mode)));
    }
};
const timer = setInterval(() => engine.tick(), 200);
const heartbeat = setInterval(() => {
  for (const [ws, p] of peers) {
    if (!p.alive) {
      ws.terminate();
      continue;
    }
    p.alive = false;
    ws.ping();
  }
}, 15000);
if (process.env.TIKFINITY_AUTOCONNECT !== "false") adapter.connect();
server.listen(port, "127.0.0.1", () =>
  console.log(
    `Tiệm Tarot ${production ? "production" : "development"} · ${origin}/admin · ${origin}/demo · ${origin}/overlay?mode=live`,
  ),
);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  clearInterval(timer);
  clearInterval(heartbeat);
  adapter.stop();
  for (const ws of peers.keys()) ws.terminate();
  wss.close();
  engine.close();
  await vite?.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on("SIGINT", () => void close());
process.on("SIGTERM", () => void close());
