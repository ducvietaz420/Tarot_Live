import { config } from "dotenv";
import { Engine } from "../server/engine.ts";
import { generateAI, words } from "../server/providers.ts";

config({ path: new URL("../backend/.env", import.meta.url), quiet: true });
const engine = new Engine();
try {
  engine.action({ type: "demo", scenario: "full" }, "demo");
  const reading = process.argv.includes("--active-demo")
    ? (await (await fetch("http://127.0.0.1:3210/api/state?mode=demo")).json())
        .session.active
    : engine.sessions.demo.active!;
  if (!reading) throw new Error("Chưa có lượt DEMO đang đọc để kiểm tra.");
  reading.config.aiModel =
    process.argv
      .find((arg) => arg.startsWith("--model="))
      ?.slice("--model=".length) ||
    process.env.AI_MODEL ||
    "";
  reading.config.aiTimeoutSec = 30;
  if (process.argv.includes("--audit")) {
    const original = globalThis.fetch;
    globalThis.fetch = async (...args) => {
      const res = await original(...args);
      try {
        const data = await res.clone().json();
        const raw = JSON.parse(data.choices?.[0]?.message?.content || "{}");
        console.log(
          JSON.stringify({
            http: res.status,
            cards: raw.cards?.map((c: any) => ({
              cardId: c.cardId,
              position: c.position,
              reversed: c.reversed,
              words: typeof c.text === "string" ? words(c.text) : null,
            })),
            summaryWords:
              typeof raw.summary === "string" ? words(raw.summary) : null,
            expected: reading.cards,
          }),
        );
      } catch {}
      return res;
    };
  }
  const start = Date.now();
  const content = await generateAI(reading, new AbortController().signal);
  console.log(
    JSON.stringify(
      {
        ok: true,
        provider: new URL(process.env.AI_BASE_URL!).hostname,
        model: reading.config.aiModel,
        elapsedMs: Date.now() - start,
        source: content.source,
        cards: content.cards.map((card) => ({
          cardId: card.cardId,
          position: card.position,
          reversed: card.reversed,
          words: words(card.text),
        })),
        summaryWords: words(content.summary),
      },
      null,
      2,
    ),
  );
} catch (error) {
  const secret = process.env.AI_API_KEY || "";
  const message = String((error as Error).message);
  console.log(
    JSON.stringify({
      ok: false,
      message: secret ? message.replaceAll(secret, "[redacted]") : message,
    }),
  );
  process.exitCode = 1;
} finally {
  engine.close();
}
