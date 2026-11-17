import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import { Engine } from "../server/engine.ts";
import { Store } from "../server/store.ts";
import { normalizeEnvelope } from "../server/tikfinity.ts";
import type { Reading } from "../shared/types.ts";
import { aiReadingContent } from "./fixtures/ai-reading.ts";

const answer = "Theo những lá vừa mở, bạn nên nói rõ điều mình cần. Hãy chọn một việc nhỏ trong tuần này rồi quan sát phản hồi thực tế.";
const questions = [
  "Mình nên bắt đầu cuộc trò chuyện thế nào?",
  "Mình cần chú ý hành động nào trong tuần tới?",
  "Nếu chưa có tiến triển thì mình nên làm gì?",
];
const secret = "followup-fixture-secret-never-echo";

function response(value: unknown) {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }));
}

interface Request {
  payload: { question: string; cards: unknown[]; previous: unknown[] };
  signal: AbortSignal;
  resolve: (value: Response) => void;
}

async function fixture(run: (context: {
  engine: () => Engine;
  reading: Reading;
  requests: Request[];
  tick: (ms: number) => void;
  draws: () => number;
  restart: () => Engine;
}) => Promise<void>) {
  const previousFetch = globalThis.fetch;
  const names = ["AI_API_KEY", "AI_BASE_URL", "AI_MODEL"] as const;
  const previousEnv = names.map((name) => process.env[name]);
  process.env.AI_API_KEY = secret;
  process.env.AI_BASE_URL = "https://fixture.invalid/v1";
  process.env.AI_MODEL = "fixture";
  let now = 1_000_000;
  let draws = 0;
  let store = new Store(":memory:");
  let engine = new Engine(store, { now: () => now, rng: () => { draws++; return 0; } });
  const requests: Request[] = [];
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options!.body as string);
    const payload = JSON.parse(body.messages[1].content);
    if (!("originalSummary" in payload))
      return response(aiReadingContent(engine.sessions.demo.active!));
    return new Promise<Response>((resolve) => {
      // Deliberately settle even after cancellation to exercise stale-job guards.
      requests.push({ payload, signal: options!.signal!, resolve });
    });
  };
  try {
    engine.action({ type: "config", config: {
      aiEnabled: true,
      aiModel: "fixture",
      aiTimeoutSec: 18,
      followUpEnabled: true,
      followUpWindowSec: 120,
      autoRun: false,
      joinMode: "free",
    } }, "demo");
    engine.action({ type: "demo", scenario: "full" }, "demo");
    await nextTurn();
    const reading = engine.sessions.demo.active!;
    assert.equal(reading.content.source, "ai", "Initial mocked reading must finish before Q&A");
    for (let index = 0; index < 7; index++) engine.advance("demo");
    assert.equal(reading.phase, "followup");
    assert.ok(reading.followUp);
    await run({
      engine: () => engine,
      reading,
      requests,
      tick: (ms) => { now += ms; engine.tick(); },
      draws: () => draws,
      restart: () => {
        const saved = store.load()!;
        engine.close();
        store = new Store(":memory:");
        store.save(saved);
        engine = new Engine(store, { now: () => now, rng: () => { draws++; return 0; } });
        return engine;
      },
    });
  } finally {
    engine.close();
    globalThis.fetch = previousFetch;
    names.forEach((name, index) => {
      if (previousEnv[index] === undefined) delete process.env[name];
      else process.env[name] = previousEnv[index];
    });
  }
}

function ask(engine: Engine, reading: Reading, question: string) {
  return engine.action({
    type: "followup-ask",
    readingId: reading.id,
    userId: reading.user.id,
    question,
  }, "demo");
}

function followUpChat(
  engine: Engine,
  reading: Reading,
  comment: string,
  options: { userId?: string; roomId?: string; msgId?: string } = {},
) {
  engine.ingest(normalizeEnvelope({ event: "chat", data: {
    userId: options.userId ?? reading.user.id,
    nickname: "Cùng nickname",
    roomId: options.roomId,
    msgId: options.msgId,
    comment,
  } }), "demo");
}

test("Hỏi đáp giữ đúng ba lá, xử lý ba câu nối tiếp và chỉ chuyển người sau câu cuối", async () => {
  await fixture(async ({ engine: current, reading, requests, draws }) => {
    const engine = current();
    const cards = structuredClone(reading.cards);
    const content = structuredClone(reading.content);
    const initialDraws = draws();
    engine.action({ type: "config", config: { autoRun: true } }, "demo");
    questions.forEach((question) => ask(engine, reading, question));
    assert.equal(reading.followUp!.questions.length, 3);
    assert.equal(requests.length, 1, "Only the first answer may generate initially");
    assert.deepEqual(reading.followUp!.questions.map((q) => q.status), ["generating", "queued", "queued"]);
    assert.equal(engine.sessions.demo.active?.id, reading.id);
    for (let index = 0; index < 3; index++) {
      assert.equal(requests.length, index + 1);
      assert.equal(requests[index].payload.question, questions[index]);
      assert.equal(requests[index].payload.previous.length, index);
      requests[index].resolve(response({ answer }));
      await nextTurn();
      assert.equal(reading.phase, "answer");
      assert.equal(reading.followUp!.currentQuestionId, reading.followUp!.questions[index].id);
      assert.equal(reading.followUp!.questions[index].status, "answered");
      assert.equal(engine.currentText("demo"), answer);
      assert.deepEqual(reading.cards, cards);
      assert.deepEqual(reading.content, content);
      assert.equal(draws(), initialDraws, "Follow-up answers must not draw any cards");
      engine.advance("demo");
      if (index < 2) {
        assert.equal(reading.phase, "followup");
        assert.equal(engine.sessions.demo.active?.id, reading.id);
      }
    }
    assert.equal(reading.phase, "complete");
    assert.equal(reading.followUp!.closedReason, "answered");
    engine.advance("demo");
    assert.notEqual(engine.sessions.demo.active?.id, reading.id);
    assert.equal(engine.sessions.demo.queue.find((q) => q.id === reading.itemId)?.status, "completed");
  });
});

test("Sai người/sai lượt/câu thứ tư bị từ chối; gửi lặp không chiếm thêm suất", async () => {
  await fixture(async ({ engine: current, reading, requests }) => {
    const engine = current();
    assert.throws(() => engine.action({ type: "followup-ask", readingId: reading.id, userId: "someone-else", question: questions[0] }, "demo"));
    assert.throws(() => engine.action({ type: "followup-ask", readingId: "stale-reading", userId: reading.user.id, question: questions[0] }, "demo"));
    ask(engine, reading, questions[0]);
    ask(engine, reading, "  " + questions[0].toLocaleUpperCase("vi").normalize("NFD") + "  ");
    assert.equal(reading.followUp!.questions.length, 1);
    assert.equal(requests.length, 1);
    ask(engine, reading, questions[1]);
    ask(engine, reading, questions[2]);
    assert.throws(() => ask(engine, reading, "Mình còn điều gì khác cần lưu ý nữa?"));
    assert.equal(reading.followUp!.questions.length, 3);
    assert.equal(requests.length, 1);
  });
});

test("Lỗi AI không bịa câu trả lời, cho thử lại cùng câu mà không dùng thêm suất", async () => {
  await fixture(async ({ engine: current, reading, requests, tick }) => {
    const engine = current();
    ask(engine, reading, questions[0]);
    const question = reading.followUp!.questions[0];
    requests[0].resolve(new Response(secret, { status: 429 }));
    await nextTurn();
    assert.equal(question.status, "failed");
    assert.match(question.error!, /hạn mức.*429/);
    assert.equal(question.answer, undefined);
    assert.equal(reading.phase, "followup");
    assert.ok(!JSON.stringify(engine.snapshot("demo")).includes(secret));
    assert.throws(() => engine.action({ type: "followup-retry", readingId: reading.id, id: question.id }, "demo"), /5 giây/);
    tick(4999);
    assert.throws(() => engine.action({ type: "followup-retry", readingId: reading.id, id: question.id }, "demo"), /5 giây/);
    tick(1);
    engine.action({ type: "followup-retry", readingId: reading.id, id: question.id }, "demo");
    assert.equal(requests.length, 2);
    assert.equal(reading.followUp!.questions.length, 1);
    assert.equal(question.status, "generating");
    requests[1].resolve(response({ answer }));
    await nextTurn();
    assert.equal(question.status, "answered");
    assert.equal(question.answer, answer);
    assert.equal(question.error, undefined);
    assert.equal(reading.phase, "answer");
    assert.throws(() => engine.action({ type: "followup-retry", readingId: reading.id, id: question.id }, "demo"));
  });
});

test("Thử lại câu hỏi lỗi tối đa ba lần và không cộng thêm câu hỏi", async () => {
  await fixture(async ({ engine: current, reading, requests, tick }) => {
    const engine = current();
    ask(engine, reading, questions[0]);
    const question = reading.followUp!.questions[0];
    for (let attempt = 0; attempt < 3; attempt++) {
      assert.equal(requests.length, attempt + 1);
      requests[attempt].resolve(new Response(secret, { status: 503 }));
      await nextTurn();
      assert.equal(question.status, "failed");
      tick(5000);
      if (attempt < 2)
        engine.action({ type: "followup-retry", readingId: reading.id, id: question.id }, "demo");
    }
    assert.equal(question.attempts, 3);
    assert.equal(reading.followUp!.questions.length, 1);
    assert.throws(() => engine.action({ type: "followup-retry", readingId: reading.id, id: question.id }, "demo"), /tối đa 3 lần/);
    assert.equal(requests.length, 3);
  });
});

test("Mốc 120 giây tuyệt đối vẫn đóng hỏi đáp khi tạm dừng", async () => {
  await fixture(async ({ engine: current, reading, tick }) => {
    const engine = current();
    const deadline = reading.followUp!.deadline;
    engine.action({ type: "pause" }, "demo");
    tick(119_999);
    assert.equal(reading.phase, "followup");
    assert.equal(reading.followUp!.deadline, deadline);
    tick(1);
    assert.equal(reading.phase, "complete");
    assert.equal(reading.followUp!.closedReason, "timeout");
    assert.throws(() => ask(engine, reading, questions[0]));
  });
});

test("Admin kết thúc hỏi đáp ngay cả khi lượt đang tạm dừng", async () => {
  await fixture(async ({ engine: current, reading, requests }) => {
    const engine = current();
    ask(engine, reading, questions[0]);
    engine.action({ type: "pause" }, "demo");
    assert.equal(reading.paused, true);
    engine.action({ type: "followup-end", readingId: reading.id }, "demo");
    assert.equal(reading.phase, "complete");
    assert.equal(reading.paused, false, "Nút kết thúc không để hàng chờ mắc ở trạng thái tạm dừng");
    assert.equal(reading.followUp!.closedReason, "admin");
    requests[0].resolve(response({ answer }));
    await nextTurn();
    assert.equal(reading.followUp!.questions[0].answer, undefined);
    assert.equal(reading.phase, "complete");
  });
});

test("Kết thúc sớm hoặc skip bỏ kết quả AI muộn, không đổi bài/lời giải của người tiếp theo", async () => {
  for (const action of ["followup-end", "skip"]) {
    await fixture(async ({ engine: current, reading, requests }) => {
      const engine = current();
      const cards = structuredClone(reading.cards);
      const content = structuredClone(reading.content);
      ask(engine, reading, questions[0]);
      engine.action({ type: action, readingId: reading.id }, "demo");
      assert.equal(requests[0].signal.aborted, true);
      if (action === "followup-end") {
        assert.equal(reading.phase, "complete");
        assert.equal(reading.followUp!.closedReason, "admin");
        engine.advance("demo");
      }
      engine.action({ type: "start" }, "demo");
      const next = engine.sessions.demo.active!;
      assert.notEqual(next.id, reading.id);
      const nextCards = structuredClone(next.cards);
      requests[0].resolve(response({ answer }));
      await nextTurn();
      assert.equal(engine.sessions.demo.active?.id, next.id);
      assert.deepEqual(next.cards, nextCards);
      assert.deepEqual(reading.cards, cards);
      assert.deepEqual(reading.content, content);
      assert.equal(reading.followUp!.questions[0].answer, undefined);
      assert.equal(next.followUp, undefined);
    });
  }
});

test("Khởi động lại giữ lượt tạm dừng, chuyển câu đang tạo thành chờ và chỉ phát lại khi tiếp tục", async () => {
  await fixture(async ({ engine: current, reading, requests, restart }) => {
    ask(current(), reading, questions[0]);
    const cards = structuredClone(reading.cards);
    const questionId = reading.followUp!.questions[0].id;
    const restored = restart();
    const active = restored.sessions.demo.active!;
    assert.equal(active.paused, true);
    assert.equal(active.id, reading.id);
    assert.deepEqual(active.cards, cards);
    assert.equal(active.followUp!.questions[0].id, questionId);
    assert.equal(active.followUp!.questions[0].status, "queued");
    assert.equal(requests.length, 1);
    restored.action({ type: "resume" }, "demo");
    assert.equal(requests.length, 2);
    requests[0].resolve(response({ answer }));
    await nextTurn();
    assert.equal(active.followUp!.questions[0].status, "generating");
    requests[1].resolve(response({ answer }));
    await nextTurn();
    assert.equal(active.followUp!.questions[0].status, "answered");
    assert.equal(restored.currentText("demo"), answer);
  });
});

test("Hoàn tất xong gửi lại cùng lệnh không tạo lượt mới trong 2 phút, kể cả msgId mới", async () => {
  await fixture(async ({ engine: current, reading, tick }) => {
    const engine = current();
    engine.action({ type: "config", config: { cooldownSec: 0 } }, "demo");
    engine.action({ type: "followup-end", readingId: reading.id }, "demo");
    engine.advance("demo");
    assert.equal(engine.sessions.demo.active, null);
    const before = engine.sessions.demo.queue.filter((q) => q.user.id === reading.user.id).length;
    const frame = (msgId?: string) => normalizeEnvelope({ event: "chat", data: {
      userId: reading.user.id,
      nickname: reading.user.name,
      msgId,
      comment: `!tarot ${reading.topic} | ${reading.question}`,
    } });
    engine.ingest(frame(), "demo");
    engine.ingest(frame("new-id-same-question"), "demo");
    assert.equal(engine.sessions.demo.queue.filter((q) => q.user.id === reading.user.id).length, before);
    tick(120_000);
    engine.ingest(frame("later-new-round"), "demo");
    assert.equal(engine.sessions.demo.queue.filter((q) => q.user.id === reading.user.id).length, before + 1);
  });
});

test("Bình luận !hoi thuộc đúng ID mới vào hỏi đáp và frame thiếu msgId lặp không dùng thêm suất", async () => {
  await fixture(async ({ engine: current, reading, requests }) => {
    const engine = current();
    const chat = (userId: string, comment: string) => normalizeEnvelope({ event: "chat", data: { userId, nickname: "Cùng nickname", comment } });
    engine.ingest(chat("another-id", "!hoi " + questions[0]), "demo");
    assert.equal(reading.followUp!.questions.length, 0);
    assert.equal(requests.length, 0);
    const frame = chat(reading.user.id, "!hoi " + questions[0]);
    engine.ingest(frame, "demo");
    engine.ingest(frame, "demo");
    assert.equal(reading.followUp!.questions.length, 1);
    assert.equal(requests.length, 1);
    assert.equal(engine.sessions.demo.queue.filter((q) => q.user.id === reading.user.id).length, 1);
  });
});

test("Frame !hoi thiếu roomId dùng phòng hiện tại và không hỏi nhầm bài thuộc phòng trước", async () => {
  await fixture(async ({ engine: current, reading, requests }) => {
    const engine = current();
    const session = engine.sessions.demo;
    session.roomId = "room-original";
    session.queue.find((item) => item.id === reading.itemId)!.roomId = "room-original";
    engine.ingest(normalizeEnvelope({ event: "roomUser", data: { roomId: "room-next", viewerCount: 10 } }), "demo");
    assert.equal(session.roomId, "room-next");
    const chat = (roomId?: string) => normalizeEnvelope({ event: "chat", data: {
      userId: reading.user.id, roomId, comment: "!hoi " + questions[0],
    } });
    engine.ingest(chat(), "demo");
    assert.equal(reading.followUp!.questions.length, 0);
    assert.equal(requests.length, 0);
    assert.ok(session.logs.some((entry) => entry.event === "followup" && entry.detail.includes("phòng")));
    engine.ingest(chat("room-original"), "demo");
    assert.equal(reading.followUp!.questions.length, 1);
    assert.equal(requests.length, 1);
  });
});

test("Ba lượt gửi riêng !hoi rồi nội dung hoạt động cả khi thiếu msgId và các câu trả lời còn đang chờ", async () => {
  await fixture(async ({ engine: current, reading, requests }) => {
    const engine = current();
    const followUp = reading.followUp!;
    const deadline = followUp.deadline;
    const cards = structuredClone(reading.cards);
    const content = structuredClone(reading.content);
    for (let index = 0; index < 3; index++) {
      const beforeRequests = requests.length;
      followUpChat(engine, reading, "!hoi");
      assert.equal(followUp.awaitingQuestion, true);
      followUpChat(engine, reading, "!hoi");
      assert.equal(followUp.awaitingQuestion, true, "Trigger lặp chỉ giữ trạng thái chờ nội dung");
      assert.equal(followUp.questions.length, index);
      assert.equal(requests.length, beforeRequests, "Chỉ gửi !hoi chưa được gọi AI");
      assert.equal(followUp.deadline, deadline, "Lệnh lặp không gia hạn hai phút");
      followUpChat(engine, reading, questions[index]);
      assert.equal(followUp.awaitingQuestion, false);
      assert.equal(followUp.questions.length, index + 1);
      assert.equal(requests.length, 1, "Câu tiếp theo phải chờ câu đang tạo/đọc");
    }
    assert.deepEqual(followUp.questions.map((question) => question.status), ["generating", "queued", "queued"]);
    followUpChat(engine, reading, "!hoi");
    assert.equal(followUp.awaitingQuestion, false, "Đủ ba câu thì không chờ câu thứ tư");
    followUpChat(engine, reading, "Tôi có thể hỏi thêm một câu nữa không?");
    assert.equal(followUp.questions.length, 3);
    for (let index = 0; index < 3; index++) {
      assert.equal(requests[index].payload.question, questions[index]);
      requests[index].resolve(response({ answer }));
      await nextTurn();
      assert.equal(reading.phase, "answer");
      assert.equal(engine.currentText("demo"), answer);
      engine.advance("demo");
    }
    assert.equal(reading.phase, "complete");
    assert.equal(followUp.closedReason, "answered");
    assert.equal(followUp.awaitingQuestion, false);
    assert.deepEqual(reading.cards, cards);
    assert.deepEqual(reading.content, content);
    followUpChat(engine, reading, "!hoi");
    assert.equal(followUp.awaitingQuestion, false, "Lệnh sau khi đóng không được mở lại hỏi đáp");
    assert.equal(requests.length, 3);
  });
});

test("Chờ nội dung sau !hoi không bắt nhầm người, giữ chờ sau câu lỗi và chỉ nhận khi đã tiếp tục", async () => {
  await fixture(async ({ engine: current, reading, requests }) => {
    const engine = current();
    const followUp = reading.followUp!;
    engine.action({ type: "pause" }, "demo");
    followUpChat(engine, reading, "!hoi");
    assert.ok(!followUp.awaitingQuestion);
    assert.equal(requests.length, 0);
    engine.action({ type: "resume" }, "demo");
    followUpChat(engine, reading, "!hoi", { userId: "another-viewer" });
    assert.ok(!followUp.awaitingQuestion, "Người khác không được mở trạng thái chờ cho chủ bài");
    followUpChat(engine, reading, "!hoi");
    assert.equal(followUp.awaitingQuestion, true);
    followUpChat(engine, reading, questions[0], { userId: "another-viewer" });
    engine.ingest(normalizeEnvelope({ event: "chat", data: { nickname: reading.user.name, comment: questions[0] } }), "demo");
    for (const comment of ["ngắn", "https://example.com/cau-hoi", "www.example.com/cau-hoi", "1234567890", "!khac câu lệnh khác"]) {
      followUpChat(engine, reading, comment);
      assert.equal(followUp.awaitingQuestion, true, `Không được mất trạng thái chờ vì: ${comment}`);
      assert.equal(followUp.questions.length, 0);
      assert.equal(requests.length, 0);
    }
    followUpChat(engine, reading, questions[0]);
    assert.equal(followUp.awaitingQuestion, false);
    assert.equal(followUp.questions.length, 1);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].payload.question, questions[0]);
  });
});

test("Cả lệnh !hoi và bình luận nội dung đều theo đúng phòng, gồm frame thiếu roomId", async () => {
  await fixture(async ({ engine: current, reading, requests }) => {
    const engine = current();
    const session = engine.sessions.demo;
    const followUp = reading.followUp!;
    session.roomId = "room-original";
    session.queue.find((item) => item.id === reading.itemId)!.roomId = "room-original";
    followUpChat(engine, reading, "!hoi", { roomId: "room-next" });
    followUpChat(engine, reading, "!hoi");
    assert.ok(!followUp.awaitingQuestion);
    followUpChat(engine, reading, "!hoi", { roomId: "room-original" });
    assert.equal(followUp.awaitingQuestion, true);
    followUpChat(engine, reading, questions[0], { roomId: "room-next" });
    assert.equal(followUp.awaitingQuestion, true);
    followUpChat(engine, reading, questions[1]);
    assert.equal(session.roomId, "room-next");
    assert.equal(followUp.awaitingQuestion, true);
    assert.equal(followUp.questions.length, 0);
    assert.equal(requests.length, 0);
    followUpChat(engine, reading, questions[0], { roomId: "room-original" });
    assert.equal(followUp.awaitingQuestion, false);
    assert.equal(followUp.questions.length, 1);
    assert.equal(requests.length, 1);
  });
});

test("Kết thúc hoặc hết hạn xóa trạng thái chờ nội dung; lệnh !hoi lặp không kéo dài cửa sổ", async () => {
  for (const reason of ["admin", "timeout"] as const) {
    await fixture(async ({ engine: current, reading, requests, tick }) => {
      const engine = current();
      const followUp = reading.followUp!;
      const deadline = followUp.deadline;
      followUpChat(engine, reading, "!hoi");
      assert.equal(followUp.awaitingQuestion, true);
      tick(1000);
      followUpChat(engine, reading, " !hỏi ");
      assert.equal(followUp.deadline, deadline);
      assert.equal(followUp.questions.length, 0);
      assert.equal(requests.length, 0);
      if (reason === "admin") engine.action({ type: "followup-end", readingId: reading.id }, "demo");
      else tick(119000);
      assert.equal(followUp.closedReason, reason);
      assert.equal(followUp.awaitingQuestion, false);
      followUpChat(engine, reading, "!hoi");
      followUpChat(engine, reading, questions[0]);
      assert.equal(followUp.awaitingQuestion, false);
      assert.equal(followUp.questions.length, 0);
      assert.equal(requests.length, 0);
    });
  }
});
