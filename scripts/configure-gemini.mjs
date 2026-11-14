import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

// Credentials arrive through stdin, never through shell arguments or output.
const root = fileURLToPath(new URL("../", import.meta.url));
if (process.stdin.isTTY) process.stdin.setRawMode(true);
const lines = createInterface({ input: process.stdin, terminal: false });
console.log("Nhập key qua stdin (không hiển thị):");
const key = await new Promise((resolveLine, reject) => {
  lines.once("line", resolveLine);
  lines.once("close", () =>
    reject(new Error("Không nhận được key qua stdin.")),
  );
});
lines.close();
if (process.stdin.isTTY) process.stdin.setRawMode(false);
if (typeof key !== "string" || !key.trim() || /\s/u.test(key.trim()))
  throw new Error("API key trống hoặc chứa khoảng trắng.");
const secret = key.trim();
const envPath = resolve(root, "backend/.env");
let env = "";
try {
  env = await readFile(envPath, "utf8");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const updates = {
  AI_BASE_URL: "https://generativelanguage.googleapis.com/v1beta/openai",
  AI_API_KEY: secret,
  AI_JSON_MODE: "true",
};
for (const [name, value] of Object.entries(updates)) {
  const row = `${name}=${value}`;
  const pattern = new RegExp(`^${name}=.*$`, "m");
  env = pattern.test(env)
    ? env.replace(pattern, () => row)
    : `${env.trimEnd()}\n${row}\n`;
}
await mkdir(resolve(root, "backend"), { recursive: true });
await writeFile(envPath, env.trimStart(), { mode: 0o600 });
console.log(
  "Đã lưu key riêng tại backend/.env. Đang kiểm tra danh sách model…",
);
try {
  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
    {
      headers: { "x-goog-api-key": secret },
      signal: AbortSignal.timeout(20000),
    },
  );
  const body = await res.json();
  if (!res.ok) {
    console.log(
      JSON.stringify({
        ok: false,
        http: res.status,
        status: body.error?.status,
        message: String(body.error?.message || "Không kết nối được Gemini")
          .replaceAll(secret, "[redacted]")
          .slice(0, 500),
      }),
    );
    process.exitCode = 1;
  } else {
    const models = (body.models || [])
      .filter((model) =>
        model.supportedGenerationMethods?.includes("generateContent"),
      )
      .map((model) => model.name.replace(/^models\//u, ""));
    const candidates = models
      .filter(
        (name) =>
          /^gemini-/u.test(name) &&
          name.includes("flash") &&
          !/(image|audio|live|tts|preview|experimental|exp-)/iu.test(name),
      )
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    console.log(
      JSON.stringify({
        ok: true,
        models: candidates,
        otherTextModels: models
          .filter(
            (name) =>
              /^gemini-/u.test(name) && !/(image|audio|live|tts)/iu.test(name),
          )
          .slice(0, 30),
      }),
    );
  }
} catch (error) {
  console.log(
    JSON.stringify({
      ok: false,
      message: String(error.message)
        .replaceAll(secret, "[redacted]")
        .slice(0, 250),
    }),
  );
  process.exitCode = 1;
}
