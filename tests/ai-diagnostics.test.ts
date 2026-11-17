import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import { Engine } from "../server/engine.ts";
import {
  AiGenerationError,
  aiFailureMessage,
  generateAI,
} from "../server/providers.ts";
import type { ReadingContent } from "../shared/types.ts";
import { aiReadingContent } from "./fixtures/ai-reading.ts";

const fakeSecret = "fixture-secret-do-not-echo";

async function fixture(run: (engine: Engine) => Promise<void>) {
  const previousFetch = globalThis.fetch;
  const names = ["AI_API_KEY", "AI_BASE_URL", "AI_MODEL"] as const;
  const previous = names.map((name) => process.env[name]);
  process.env.AI_API_KEY = fakeSecret;
  process.env.AI_BASE_URL = "https://fixture.invalid/v1";
  process.env.AI_MODEL = "fixture-model";
  const engine = new Engine(undefined, { rng: () => 0 });
  try {
    engine.action({ type: "config", config: { joinMode: "free", aiEnabled: false } }, "demo");
    await run(engine);
  } finally {
    engine.close();
    globalThis.fetch = previousFetch;
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    });
  }
}

function start(engine: Engine) {
  engine.action({ type: "demo", scenario: "full" }, "demo");
  return engine.sessions.demo.active!;
}

function response(content: ReadingContent) {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }));
}

test("AI thiếu cấu hình báo đúng nguyên nhân mà không gọi dịch vụ", async () => {
  await fixture(async (engine) => {
    const reading = start(engine);
    delete process.env.AI_API_KEY;
    let calls = 0;
    globalThis.fetch = async () => { calls++; throw new Error(fakeSecret); };
    await assert.rejects(generateAI(reading, new AbortController().signal), (error: unknown) => {
      assert.ok(error instanceof AiGenerationError);
      assert.equal(error.code, "configuration");
      assert.match(aiFailureMessage(error), /chưa có đủ/);
      return true;
    });
    assert.equal(calls, 0);
  });
});

test("Lỗi HTTP AI được phân loại theo status, không đưa body hay khóa vào trạng thái", async () => {
  await fixture(async (engine) => {
    const reading = start(engine);
    for (const [status, pattern] of [
      [401, /khóa API.*401/],
      [403, /quyền truy cập.*403/],
      [429, /hạn mức.*429/],
      [503, /lỗi máy chủ/],
    ] as const) {
      globalThis.fetch = async () => new Response(fakeSecret, { status });
      await assert.rejects(generateAI(reading, new AbortController().signal), (error: unknown) => {
        assert.ok(error instanceof AiGenerationError);
        assert.equal(error.status, status);
        const message = aiFailureMessage(error);
        assert.match(message, pattern);
        assert.ok(!message.includes(fakeSecret));
        return true;
      });
    }
  });
});

test("JSON lỗi, nội dung sai cấu trúc và timeout có thông báo riêng an toàn", async () => {
  await fixture(async (engine) => {
    const reading = start(engine);
    const cases = [
      { fetch: async () => new Response(fakeSecret), code: "json" },
      { fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] })), code: "schema" },
      { fetch: async (): Promise<Response> => { throw new DOMException(fakeSecret, "TimeoutError"); }, code: "timeout" },
    ];
    for (const item of cases) {
      globalThis.fetch = item.fetch;
      await assert.rejects(generateAI(reading, new AbortController().signal), (error: unknown) => {
        assert.ok(error instanceof AiGenerationError);
        assert.equal(error.code, item.code);
        assert.ok(!aiFailureMessage(error).includes(fakeSecret));
        return true;
      });
    }
  });
});

test("Lỗi không biết không bao giờ phản chiếu Error.message hoặc nội dung nhạy cảm", async () => {
  await fixture(async (engine) => {
    const raw = new Error("provider included authorization=" + fakeSecret);
    assert.match(aiFailureMessage(raw), /Không kết nối/);
    assert.ok(!aiFailureMessage(raw).includes(fakeSecret));
    globalThis.fetch = async () => { throw raw; };
    engine.action({ type: "config", config: { aiEnabled: true } }, "demo");
    start(engine);
    await nextTurn();
    const snapshot = engine.snapshot("demo");
    assert.equal(snapshot.session.active!.content.source, "fallback");
    assert.match(snapshot.session.active!.content.error!, /Không kết nối/);
    assert.ok(!JSON.stringify(snapshot).includes(fakeSecret));
    assert.equal(snapshot.aiPending, false);
  });
});

test("Engine lưu lỗi hạn mức cụ thể và phát pending true rồi false", async () => {
  await fixture(async (engine) => {
    const updates: (boolean | undefined)[] = [];
    engine.onChange = () => updates.push(engine.snapshot("demo").aiPending);
    globalThis.fetch = async () => new Response(fakeSecret, { status: 429 });
    engine.action({ type: "config", config: { aiEnabled: true } }, "demo");
    start(engine);
    assert.equal(engine.snapshot("demo").aiPending, true);
    await nextTurn();
    const state = engine.snapshot("demo");
    assert.match(state.session.active!.content.error!, /hạn mức.*429/);
    assert.equal(state.aiPending, false);
    assert.ok(updates.includes(true));
    assert.equal(updates.at(-1), false);
    assert.ok(!JSON.stringify(state).includes(fakeSecret));
  });
});

test("Tiếp tục khi AI đang chuẩn bị chỉ tạo lại tác vụ đã hủy, giữ nguyên ba lá", async () => {
  await fixture(async (engine) => {
    const pending: { signal: AbortSignal; resolve: (result: Response) => void }[] = [];
    globalThis.fetch = async (_url, options) => new Promise<Response>((resolve) => {
      pending.push({ signal: options!.signal!, resolve });
    });
    engine.action({ type: "config", config: { aiEnabled: true } }, "demo");
    const reading = start(engine);
    const cards = structuredClone(reading.cards);
    const content = aiReadingContent(reading);
    assert.equal(pending.length, 1);
    assert.equal(engine.snapshot("demo").aiPending, true);
    engine.action({ type: "pause" }, "demo");
    assert.equal(pending[0].signal.aborted, true);
    assert.equal(engine.snapshot("demo").aiPending, false);
    engine.action({ type: "resume" }, "demo");
    assert.equal(pending.length, 2);
    assert.equal(engine.snapshot("demo").aiPending, true);
    pending[0].resolve(response(content));
    await nextTurn();
    assert.equal(reading.content.source, "fallback");
    assert.equal(engine.snapshot("demo").aiPending, true, "Tác vụ cũ không được xóa pending mới");
    pending[1].resolve(response(content));
    await nextTurn();
    assert.equal(reading.content.source, "ai");
    assert.deepEqual(reading.cards, cards);
    assert.equal(engine.snapshot("demo").aiPending, false);
    for (let index = 0; index < 3; index++) engine.advance("demo");
    assert.equal(reading.phase, "card1");
    engine.action({ type: "pause" }, "demo");
    engine.action({ type: "resume" }, "demo");
    assert.equal(pending.length, 2, "Không tạo lại lời giải sau khi đã bắt đầu đọc");
  });
});
