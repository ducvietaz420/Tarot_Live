import test from "node:test";
import assert from "node:assert/strict";
import { Engine, DEFAULT_CONFIG } from "../server/engine.ts";
import {
  fallback,
  synthesize,
  words,
  validateAI,
} from "../server/providers.ts";
import { CARDS } from "../shared/cards.ts";
import { TOPICS, type Reading, type ReadingContent } from "../shared/types.ts";
import { normalizeEnvelope } from "../server/tikfinity.ts";

test("AI hơi dài được rút gọn, vẫn giữ đúng bài, lời đọc và giới hạn từ", () => {
  const engine = new Engine();
  try {
    engine.action({ type: "demo", scenario: "full" }, "demo");
    const reading = engine.sessions.demo.active!;
    const raw = structuredClone(reading.content);
    const extra =
      " Bạn có thể ghi lại cảm xúc của mình và dành thời gian quan sát thêm trước khi chọn một bước tiếp theo.";
    raw.cards.forEach((card) => {
      card.text += extra;
      card.speech = card.text;
    });
    raw.summary += extra;
    assert.ok(
      raw.cards.some(
        (card) => words(card.text) > reading.config.displayWords + 10,
      ),
    );
    const validated = validateAI(raw, reading);
    assert.deepEqual(
      validated.cards.map(({ cardId, position, reversed }) => ({
        cardId,
        position,
        reversed,
      })),
      reading.cards,
    );
    for (const card of validated.cards) {
      assert.ok(
        words(card.text) >= 45 &&
          words(card.text) <= reading.config.displayWords,
      );
      assert.equal(card.text, card.speech);
    }
    assert.ok(
      words(validated.summary) >= 35 &&
        words(validated.summary) <= reading.config.summaryWords,
    );
    raw.cards[0].text = "nội dung ".repeat(200);
    assert.throws(() => validateAI(raw, reading));
  } finally {
    engine.close();
  }
});

test("Mọi lá/chủ đề/chiều đều có 45–70 từ, giữ gợi ý đúng chủ đề và lời đọc đúng chữ", () => {
  for (const max of [45, 65, 70])
    for (const c of CARDS)
      for (const topic of TOPICS)
        for (const reversed of [true, false]) {
          const reading = {
            cards: [
              { cardId: c.id, position: 0, reversed },
              { cardId: CARDS[1].id, position: 1, reversed: false },
              { cardId: CARDS[2].id, position: 2, reversed: true },
            ],
            topic,
            question: "Một câu hỏi tự chiêm nghiệm",
            config: { ...DEFAULT_CONFIG, displayWords: max },
          };
          const result = fallback(reading);
          assert.ok(
            words(result.cards[0].text) >= 45,
            `${c.id}/${topic}: ${result.cards[0].text}`,
          );
          assert.ok(words(result.cards[0].text) <= max);
          assert.ok(
            result.cards[0].text.includes(c.topics[topic]),
            `${c.id} thiếu gợi ý ${topic}`,
          );
          assert.equal(result.cards[0].text, result.cards[0].speech);
          assert.ok(words(result.summary) >= 35 && words(result.summary) <= 55);
        }
});
test("AI timeout thật chuyển fallback; kết quả cũ sau skip không chèn vào lượt mới", async () => {
  const previous = {
    fetch: globalThis.fetch,
    key: process.env.AI_API_KEY,
    url: process.env.AI_BASE_URL,
    model: process.env.AI_MODEL,
  };
  process.env.AI_API_KEY = "fixture-only";
  process.env.AI_BASE_URL = "https://fixture.invalid/v1";
  process.env.AI_MODEL = "fixture";
  const requests: {
    body: Record<string, unknown>;
    resolve: (v: Response) => void;
    signal: AbortSignal;
  }[] = [];
  globalThis.fetch = async (_url, init) =>
    await new Promise<Response>((resolve, reject) => {
      const signal = init!.signal!;
      requests.push({
        body: JSON.parse(init!.body as string),
        resolve,
        signal,
      });
      signal.addEventListener(
        "abort",
        () => reject(new DOMException("aborted", "AbortError")),
        { once: true },
      );
    });
  const e = new Engine();
  try {
    e.action(
      {
        type: "config",
        config: { joinMode: "free", aiEnabled: true, aiTimeoutSec: 2 },
      },
      "demo",
    );
    const emit = (id: string) =>
      e.ingest(
        normalizeEnvelope({
          event: "chat",
          data: {
            userId: id,
            msgId: `q-${id}`,
            nickname: id,
            comment:
              "!tarot công việc | Tôi nên phát triển điều gì trong thời gian tới?",
          },
        }),
        "demo",
      );
    emit("person-1");
    emit("person-2");
    e.start("demo");
    const old = e.sessions.demo.active!;
    assert.equal(requests.length, 1);
    e.action({ type: "skip" }, "demo");
    e.action({ type: "start" }, "demo");
    const current = e.sessions.demo.active!;
    assert.notEqual(old.id, current.id);
    assert.ok(requests[0].signal.aborted);
    requests[0].resolve(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(old.content) } }],
        }),
        { status: 200 },
      ),
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(e.sessions.demo.active?.id, current.id);
    assert.equal(e.sessions.demo.active?.content.source, "fallback");
    await new Promise((resolve) => setTimeout(resolve, 2150));
    assert.equal(e.sessions.demo.active?.content.source, "fallback");
    assert.ok(e.sessions.demo.active?.content.error);
    assert.deepEqual(e.sessions.demo.active?.cards, current.cards);
    assert.equal(requests.length, 2);
  } finally {
    e.close();
    globalThis.fetch = previous.fetch;
    for (const [key, value] of [
      ["AI_API_KEY", previous.key],
      ["AI_BASE_URL", previous.url],
      ["AI_MODEL", previous.model],
    ]) {
      if (value === undefined) delete process.env[key!];
      else process.env[key!] = value;
    }
  }
});
test("TTS chưa cấu hình hoặc response không audio báo lỗi để UI giữ chữ", async () => {
  const previous = { fetch: globalThis.fetch, url: process.env.TTS_URL };
  const e = new Engine();
  try {
    e.action({ type: "config", config: { joinMode: "free" } }, "demo");
    e.action({ type: "demo", scenario: "full" }, "demo");
    const r = e.sessions.demo.active as Reading;
    r.phase = "card1";
    delete process.env.TTS_URL;
    await assert.rejects(
      () => synthesize(r, new AbortController().signal),
      /Chưa cấu hình/,
    );
    process.env.TTS_URL = "https://fixture.invalid/tts";
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ url: "https://example.invalid/file.mp3" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    await assert.rejects(
      () => synthesize(r, new AbortController().signal),
      /trả trực tiếp file/,
    );
    assert.equal(e.sessions.demo.active?.id, r.id);
  } finally {
    e.close();
    globalThis.fetch = previous.fetch;
    if (previous.url === undefined) delete process.env.TTS_URL;
    else process.env.TTS_URL = previous.url;
  }
});
