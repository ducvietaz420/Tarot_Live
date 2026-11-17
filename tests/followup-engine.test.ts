import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import { Engine } from "../server/engine.ts";
import { Store, type SavedState } from "../server/store.ts";
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
  restart: (update?: (saved: SavedState) => void) => Engine;
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
      restart: (update) => {
        const saved = store.load()!;
        update?.(saved);
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

test("Bình luận thường mở ba câu hỏi nối tiếp, giữ nguyên ba lá và lời giải", async () => {
  await fixture(async ({ engine: current, reading, requests, draws }) => {
    const engine = current();
    const cards = structuredClone(reading.cards);
    const content = structuredClone(reading.content);
    const initialDraws = draws();
    const followUp = reading.followUp!;
    assert.equal(followUp.awaitingQuestion, true);
    assert.equal(followUp.deadline - followUp.openedAt, 30_000);
    engine.action({ type: "config", config: { autoRun: true } }, "demo");
    for (let index = 0; index < 3; index++) {
      assert.equal(followUp.awaitingQuestion, true);
      followUpChat(engine, reading, questions[index]);
      assert.equal(followUp.questions.length, index + 1);
      assert.equal(followUp.awaitingQuestion, false);
      assert.equal(followUp.deadline, 0, "Thời gian tạo và đọc đáp án không trừ thời gian đặt câu hỏi");
      assert.equal(requests.length, index + 1);
      assert.equal(requests[index].payload.question, questions[index]);
      assert.equal(requests[index].payload.previous.length, index);
      requests[index].resolve(response({ answer }));
      await nextTurn();
      assert.equal(reading.phase, "answer");
      assert.equal(followUp.currentQuestionId, followUp.questions[index].id);
      assert.equal(followUp.questions[index].status, "answered");
      assert.equal(engine.currentText("demo"), answer);
      assert.deepEqual(reading.cards, cards);
      assert.deepEqual(reading.content, content);
      assert.equal(draws(), initialDraws, "Hỏi tiếp không rút bài mới");
      engine.advance("demo");
      if (index < 2) {
        assert.equal(reading.phase, "followup");
        assert.equal(followUp.deadline - engine.snapshot("demo").serverTime, 30_000);
        assert.equal(engine.sessions.demo.active?.id, reading.id);
      }
    }
    assert.equal(reading.phase, "complete");
    assert.equal(followUp.closedReason, "answered");
    assert.equal(followUp.awaitingQuestion, false);
    engine.advance("demo");
    assert.notEqual(engine.sessions.demo.active?.id, reading.id);
    assert.equal(engine.sessions.demo.queue.find((q) => q.id === reading.itemId)?.status, "completed");
  });
});

test("Sai người/sai lượt bị từ chối, câu đang xử lý không nhận thêm câu và không vượt quá ba câu", async () => {
  await fixture(async ({ engine: current, reading, requests }) => {
    const engine = current();
    assert.throws(() => engine.action({ type: "followup-ask", readingId: reading.id, userId: "someone-else", question: questions[0] }, "demo"));
    assert.throws(() => engine.action({ type: "followup-ask", readingId: "stale-reading", userId: reading.user.id, question: questions[0] }, "demo"));
    for (let index = 0; index < 3; index++) {
      followUpChat(engine, reading, questions[index]);
      followUpChat(engine, reading, "  " + questions[index].toLocaleUpperCase("vi").normalize("NFD") + "  ");
      followUpChat(engine, reading, "Mình còn cần chuẩn bị điều gì khác nữa?");
      assert.equal(reading.followUp!.questions.length, index + 1);
      assert.equal(requests.length, index + 1);
      requests[index].resolve(response({ answer }));
      await nextTurn();
      followUpChat(engine, reading, "Tôi muốn hỏi thêm ngay khi bạn đang trả lời?");
      assert.equal(reading.followUp!.questions.length, index + 1);
      engine.advance("demo");
    }
    assert.throws(() => ask(engine, reading, "Mình có thể hỏi thêm câu thứ tư được không?"));
    assert.equal(reading.followUp!.questions.length, 3);
    assert.equal(requests.length, 3);
  });
});

test("Mỗi câu có đủ 30 giây, thời gian AI tạo hoặc đọc câu trả lời không làm hết lượt hỏi tiếp", async () => {
  await fixture(async ({ engine: current, reading, requests, tick }) => {
    const engine = current();
    tick(29_999);
    followUpChat(engine, reading, questions[0]);
    assert.equal(requests.length, 1);
    tick(60_000);
    assert.equal(reading.phase, "followup");
    assert.equal(reading.followUp!.closedReason, undefined);
    assert.equal(reading.followUp!.deadline, 0);
    requests[0].resolve(response({ answer }));
    await nextTurn();
    assert.equal(reading.phase, "answer");
    assert.equal(reading.followUp!.deadline, 0);
    engine.advance("demo");
    const nextDeadline = reading.followUp!.deadline;
    assert.equal(nextDeadline - engine.snapshot("demo").serverTime, 30_000);
    tick(29_999);
    assert.equal(reading.phase, "followup");
    assert.equal(reading.followUp!.deadline, nextDeadline);
    followUpChat(engine, reading, questions[1]);
    assert.equal(requests.length, 2);
    assert.equal(reading.followUp!.questions.length, 2);
  });
});

test("Lỗi AI không bịa câu trả lời, mở lại 30 giây và thử lại cùng câu không dùng thêm suất", async () => {
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
    assert.equal(reading.followUp!.awaitingQuestion, true);
    assert.equal(reading.followUp!.deadline - engine.snapshot("demo").serverTime, 30_000);
    assert.ok(!JSON.stringify(engine.snapshot("demo")).includes(secret));
    assert.throws(() => engine.action({ type: "followup-retry", readingId: reading.id, id: question.id }, "demo"), /5 giây/);
    tick(4999);
    assert.throws(() => engine.action({ type: "followup-retry", readingId: reading.id, id: question.id }, "demo"), /5 giây/);
    tick(1);
    followUpChat(engine, reading, questions[0], { msgId: "retry-same-question" });
    assert.equal(requests.length, 2);
    assert.equal(reading.followUp!.questions.length, 1);
    assert.equal(question.status, "generating");
    assert.equal(reading.followUp!.deadline, 0);
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
      if (attempt < 2) engine.action({ type: "followup-retry", readingId: reading.id, id: question.id }, "demo");
    }
    assert.equal(question.attempts, 3);
    assert.equal(reading.followUp!.questions.length, 1);
    assert.throws(() => engine.action({ type: "followup-retry", readingId: reading.id, id: question.id }, "demo"), /tối đa 3 lần/);
    assert.equal(requests.length, 3);
  });
});

test("Không bình luận trước hạn 30 giây sẽ kết thúc hỏi đáp, kể cả khi tạm dừng", async () => {
  await fixture(async ({ engine: current, reading, tick }) => {
    const engine = current();
    const deadline = reading.followUp!.deadline;
    engine.action({ type: "pause" }, "demo");
    tick(29_999);
    assert.equal(reading.phase, "followup");
    assert.equal(reading.followUp!.deadline, deadline);
    tick(1);
    assert.equal(reading.phase, "complete");
    assert.equal(reading.followUp!.closedReason, "timeout");
    assert.equal(reading.followUp!.awaitingQuestion, false);
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
    assert.equal(reading.paused, false);
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
    assert.equal(active.followUp!.awaitingQuestion, false);
    assert.equal(active.followUp!.deadline, 0);
    assert.equal(requests.length, 1);
    restored.action({ type: "resume" }, "demo");
    assert.equal(requests.length, 2);
    followUpChat(restored, active, questions[1]);
    assert.equal(active.followUp!.questions.length, 1, "Khôi phục câu đang tạo không được mở khung nhận câu mới");
    assert.equal(active.followUp!.awaitingQuestion, false);
    assert.equal(active.followUp!.deadline, 0);
    requests[0].resolve(response({ answer }));
    await nextTurn();
    assert.equal(active.followUp!.questions[0].status, "generating");
    requests[1].resolve(response({ answer }));
    await nextTurn();
    assert.equal(active.followUp!.questions[0].status, "answered");
    assert.equal(restored.currentText("demo"), answer);
  });
});

test("Phiên hỏi đáp cũ thiếu trạng thái chờ được khôi phục và nhận bình luận hoặc câu nhập từ admin", async () => {
  for (const legacy of [
    { awaitingQuestion: undefined, deadline: 1_120_000, via: "comment" },
    { awaitingQuestion: false, deadline: 0, via: "admin" },
    { awaitingQuestion: true, deadline: 0, via: "comment", restartTwice: true },
  ] as const) {
    await fixture(async ({ reading, requests, restart, tick }) => {
      const cards = structuredClone(reading.cards);
      let restored = restart((saved) => {
        const followUp = saved.sessions.demo.active!.followUp!;
        followUp.awaitingQuestion = legacy.awaitingQuestion;
        followUp.deadline = legacy.deadline;
      });
      if ("restartTwice" in legacy && legacy.restartTwice) restored = restart();
      const active = restored.sessions.demo.active!;
      assert.equal(active.paused, true);
      assert.equal(active.phase, "followup");
      assert.equal(active.followUp!.questions.length, 0);
      assert.equal(requests.length, 0, "Chỉ khôi phục trạng thái không tự gọi AI");
      tick(150_000);
      assert.equal(active.phase, "followup", "Phiên cũ được sửa phải chờ quản trị tiếp tục trước khi tính 30 giây mới");
      assert.equal(active.paused, true);
      restored.action({ type: "resume" }, "demo");
      assert.equal(active.followUp!.awaitingQuestion, true);
      assert.equal(active.followUp!.deadline - restored.snapshot("demo").serverTime, 30_000);
      if (legacy.via === "comment") followUpChat(restored, active, questions[0]);
      else ask(restored, active, questions[0]);
      assert.equal(active.followUp!.questions.length, 1);
      assert.equal(requests.length, 1);
      assert.equal(requests[0].payload.question, questions[0]);
      assert.equal(active.followUp!.awaitingQuestion, false);
      assert.equal(active.followUp!.deadline, 0);
      assert.deepEqual(active.cards, cards);
    });
  }
});

test("Khôi phục lúc đọc đáp án vẫn giữ trạng thái bận và chỉ mở câu kế tiếp sau khi đọc xong", async () => {
  await fixture(async ({ engine: current, reading, requests, restart }) => {
    ask(current(), reading, questions[0]);
    requests[0].resolve(response({ answer }));
    await nextTurn();
    assert.equal(reading.phase, "answer");
    const restored = restart();
    const active = restored.sessions.demo.active!;
    assert.equal(active.paused, true);
    assert.equal(active.phase, "answer");
    assert.equal(active.followUp!.awaitingQuestion, false);
    assert.equal(active.followUp!.deadline, 0);
    restored.action({ type: "resume" }, "demo");
    followUpChat(restored, active, questions[1]);
    assert.equal(active.followUp!.questions.length, 1);
    assert.equal(requests.length, 1);
    assert.equal(restored.currentText("demo"), answer);
    restored.advance("demo");
    assert.equal(active.phase, "followup");
    assert.equal(active.followUp!.awaitingQuestion, true);
    assert.equal(active.followUp!.deadline - restored.snapshot("demo").serverTime, 30_000);
  });
});

test("Khôi phục cửa sổ 30 giây hợp lệ đã hết hạn không được tự gia hạn", async () => {
  await fixture(async ({ restart, requests }) => {
    const expiredDeadline = 999_999;
    const restored = restart((saved) => {
      const followUp = saved.sessions.demo.active!.followUp!;
      followUp.awaitingQuestion = true;
      followUp.deadline = expiredDeadline;
      followUp.openedAt = expiredDeadline - 30_000;
    });
    const active = restored.sessions.demo.active!;
    assert.equal(active.paused, true);
    assert.equal(active.followUp!.deadline, expiredDeadline);
    restored.action({ type: "resume" }, "demo");
    restored.tick();
    assert.equal(active.phase, "complete");
    assert.equal(active.followUp!.closedReason, "timeout");
    assert.equal(active.followUp!.awaitingQuestion, false);
    assert.equal(requests.length, 0);
  });
});

test("Hoàn tất xong gửi lại cùng câu hỏi không tạo lượt mới trong 2 phút, kể cả msgId mới", async () => {
  await fixture(async ({ engine: current, reading, tick }) => {
    const engine = current();
    engine.action({ type: "config", config: { cooldownSec: 0 } }, "demo");
    engine.action({ type: "followup-end", readingId: reading.id }, "demo");
    engine.advance("demo");
    assert.equal(engine.sessions.demo.active, null);
    const before = engine.sessions.demo.queue.filter((q) => q.user.id === reading.user.id).length;
    const frame = (msgId?: string) => normalizeEnvelope({ event: "chat", data: {
      userId: reading.user.id, nickname: reading.user.name, msgId,
      comment: `tarot ${reading.topic} | ${reading.question}`,
    } });
    engine.ingest(frame(), "demo");
    engine.ingest(frame("new-id-same-question"), "demo");
    assert.equal(engine.sessions.demo.queue.filter((q) => q.user.id === reading.user.id).length, before);
    tick(120_000);
    engine.ingest(frame("later-new-round"), "demo");
    assert.equal(engine.sessions.demo.queue.filter((q) => q.user.id === reading.user.id).length, before + 1);
  });
});

test("Bình luận thường chỉ nhận đúng ID chủ bài và lọc frame thiếu msgId lặp", async () => {
  await fixture(async ({ engine: current, reading, requests }) => {
    const engine = current();
    followUpChat(engine, reading, questions[0], { userId: "another-id" });
    assert.equal(reading.followUp!.questions.length, 0);
    assert.equal(requests.length, 0);
    followUpChat(engine, reading, questions[0]);
    followUpChat(engine, reading, questions[0]);
    assert.equal(reading.followUp!.questions.length, 1);
    assert.equal(requests.length, 1);
    assert.equal(engine.sessions.demo.queue.filter((q) => q.user.id === reading.user.id).length, 1);
  });
});

test("Bình luận thiếu roomId dùng phòng hiện tại, không nhận câu hỏi từ phòng khác", async () => {
  await fixture(async ({ engine: current, reading, requests }) => {
    const engine = current();
    const session = engine.sessions.demo;
    session.roomId = "room-original";
    session.queue.find((item) => item.id === reading.itemId)!.roomId = "room-original";
    engine.ingest(normalizeEnvelope({ event: "roomUser", data: { roomId: "room-next", viewerCount: 10 } }), "demo");
    followUpChat(engine, reading, questions[0]);
    assert.equal(reading.followUp!.questions.length, 0);
    assert.equal(requests.length, 0);
    followUpChat(engine, reading, questions[0], { roomId: "room-original" });
    assert.equal(reading.followUp!.questions.length, 1);
    assert.equal(requests.length, 1);
  });
});

test("Tạm dừng và bình luận không hợp lệ không mất suất hỏi hay gia hạn bộ đếm", async () => {
  await fixture(async ({ engine: current, reading, requests }) => {
    const engine = current();
    const followUp = reading.followUp!;
    const deadline = followUp.deadline;
    engine.action({ type: "pause" }, "demo");
    followUpChat(engine, reading, questions[0]);
    assert.equal(followUp.questions.length, 0);
    assert.equal(requests.length, 0);
    engine.action({ type: "resume" }, "demo");
    followUpChat(engine, reading, questions[0], { userId: "another-viewer" });
    engine.ingest(normalizeEnvelope({ event: "chat", data: { nickname: reading.user.name, comment: questions[0] } }), "demo");
    for (const comment of ["ngắn", "https://example.com/cau-hoi", "www.example.com/cau-hoi", "1234567890", "!hoi", "!hoi Tôi nên làm gì tiếp theo?", "!khac câu lệnh khác"]) {
      followUpChat(engine, reading, comment);
      assert.equal(followUp.awaitingQuestion, true, `Câu không hợp lệ vẫn giữ khung hỏi: ${comment}`);
      assert.equal(followUp.deadline, deadline);
      assert.equal(followUp.questions.length, 0);
      assert.equal(requests.length, 0);
    }
    followUpChat(engine, reading, questions[0], { msgId: "after-resume-valid" });
    assert.equal(followUp.awaitingQuestion, false);
    assert.equal(followUp.questions.length, 1);
    assert.equal(requests.length, 1);
  });
});

test("Kết thúc hoặc hết hạn xóa khung chờ, bình luận tiếp không mở lại phần hỏi đáp", async () => {
  for (const reason of ["admin", "timeout"] as const) {
    await fixture(async ({ engine: current, reading, requests, tick }) => {
      const engine = current();
      const followUp = reading.followUp!;
      const deadline = followUp.deadline;
      tick(1000);
      followUpChat(engine, reading, "!hoi");
      assert.equal(followUp.deadline, deadline);
      assert.equal(followUp.questions.length, 0);
      assert.equal(requests.length, 0);
      if (reason === "admin") engine.action({ type: "followup-end", readingId: reading.id }, "demo");
      else tick(29_000);
      assert.equal(followUp.closedReason, reason);
      assert.equal(followUp.awaitingQuestion, false);
      followUpChat(engine, reading, questions[0]);
      assert.equal(followUp.awaitingQuestion, false);
      assert.equal(followUp.questions.length, 0);
      assert.equal(requests.length, 0);
    });
  }
});
