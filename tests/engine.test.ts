import test from "node:test";
import assert from "node:assert/strict";
import {
  Engine,
  DEFAULT_CONFIG,
  blankSession,
  parseQuestion,
  validateConfig,
} from "../server/engine.ts";
import { Store } from "../server/store.ts";
import { normalizeEnvelope } from "../server/tikfinity.ts";
import { validateAI, words } from "../server/providers.ts";
import { CARDS } from "../shared/cards.ts";
import { aiReadingContent } from "./fixtures/ai-reading.ts";

function setup() {
  let time = 1_000_000;
  const store = new Store(":memory:");
  const e = new Engine(store, { now: () => time, rng: () => 0 });
  // These ledger/state-machine cases explicitly exercise the manual gift gate.
  // The conversational flow and its automatic donor priority have separate tests.
  e.action({ type: "config", config: {
    autoRun: false, joinMode: "gift_question", priority: false,
    durations: { shuffling: 3, dealing: 2 },
  } }, "demo");
  const advance = (ms: number) => {
    time += ms;
    e.tick();
  };
  return { e, store, advance };
}
const user = (id: string) => ({
  userId: id,
  nickname: "Minh Anh",
  uniqueId: `handle_${id}`,
  profilePictureUrl: `/assets/avatars/avatar-${Number(id) % 10 || 0}.svg`,
});
const chat = (
  id: string,
  eventId = `q-${id}`,
  question = "Tôi nên tập trung phát triển điều gì trong giai đoạn tới?",
) =>
  normalizeEnvelope({
    event: "chat",
    data: {
      ...user(id),
      msgId: eventId,
      comment: `!tarot công việc | ${question}`,
    },
  });
const gift = (
  id: string,
  eventId = `g-${id}`,
  extra: Record<string, unknown> = {},
) =>
  normalizeEnvelope({
    event: "gift",
    data: {
      ...user(id),
      msgId: eventId,
      giftId: "rose",
      giftName: "Hoa hồng",
      giftType: 0,
      repeatCount: 1,
      repeatEnd: true,
      diamondCount: 1,
      ...extra,
    },
  });

test("78 lá có ID/asset/nội dung khác nhau, xuôi/ngược và đủ 5 chủ đề", () => {
  assert.equal(CARDS.length, 78);
  assert.equal(new Set(CARDS.map((c) => c.id)).size, 78);
  assert.equal(CARDS.filter((c) => c.group === "Ẩn chính").length, 22);
  for (const c of CARDS) {
    assert.ok(c.vi && c.en && c.asset);
    assert.notEqual(c.upright, c.reversed);
    assert.equal(Object.keys(c.topics).length, 5);
  }
});
test("Bộ phân tích nhận từ khóa cấu hình hoặc ý định rõ, không nhận chào/emoji", () => {
  assert.equal(parseQuestion("Chào chị ạ ❤️", DEFAULT_CONFIG), undefined);
  assert.equal(parseQuestion("🔥🔥🔥", DEFAULT_CONFIG), undefined);
  assert.equal(
    parseQuestion("Tình duyên: cho em xem mối quan hệ hiện tại", DEFAULT_CONFIG)
      ?.topic,
    "Tình duyên",
  );
  assert.equal(
    parseQuestion(
      "tarot học hành | Làm sao học tập hiệu quả hơn?",
      DEFAULT_CONFIG,
    )?.topic,
    "Học hành",
  );
  assert.ok(
    parseQuestion(
      "Cho em xem bài về bước tiếp theo trong cuộc sống",
      DEFAULT_CONFIG,
    ),
  );
  assert.equal(
    parseQuestion("tarot công việc | https://example.com", DEFAULT_CONFIG),
    undefined,
  );
});

test("AI chậm hơn animation vẫn hoàn tất trước khi bắt đầu đọc lá đầu", async () => {
  const previous = {
    fetch: globalThis.fetch,
    key: process.env.AI_API_KEY,
    url: process.env.AI_BASE_URL,
    model: process.env.AI_MODEL,
  };
  process.env.AI_API_KEY = "fixture-only";
  process.env.AI_BASE_URL = "https://fixture.invalid/v1";
  process.env.AI_MODEL = "fixture";
  let respond!: (value: Response) => void;
  globalThis.fetch = async () =>
    await new Promise<Response>((resolve) => {
      respond = resolve;
    });
  const { e, advance } = setup();
  try {
    e.action(
      {
        type: "config",
        config: { joinMode: "free", aiEnabled: true, aiTimeoutSec: 18 },
      },
      "demo",
    );
    e.ingest(chat("1"), "demo");
    e.start("demo");
    const reading = e.sessions.demo.active!;
    const fixedCards = structuredClone(reading.cards);
    advance(2000);
    advance(3000);
    advance(2000);
    advance(1500);
    assert.equal(
      reading.phase,
      "dealing",
      "Chưa đọc fallback khi AI còn trong thời hạn",
    );
    respond(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(aiReadingContent(reading)) } }],
        }),
        { status: 200 },
      ),
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(reading.content.source, "ai");
    assert.equal(reading.phase, "dealing");
    e.tick();
    assert.equal(reading.phase, "card1");
    assert.deepEqual(reading.cards, fixedCards);
  } finally {
    e.close();
    globalThis.fetch = previous.fetch;
    for (const [name, value] of [
      ["AI_API_KEY", previous.key],
      ["AI_BASE_URL", previous.url],
      ["AI_MODEL", previous.model],
    ]) {
      if (value === undefined) delete process.env[name!];
      else process.env[name!] = value;
    }
  }
});

test("Hết hạn chờ AI không kẹt sân khấu; kết quả muộn không thay lời đang đọc", async () => {
  const previous = {
    fetch: globalThis.fetch,
    key: process.env.AI_API_KEY,
    url: process.env.AI_BASE_URL,
    model: process.env.AI_MODEL,
  };
  process.env.AI_API_KEY = "fixture-only";
  process.env.AI_BASE_URL = "https://fixture.invalid/v1";
  process.env.AI_MODEL = "fixture";
  let respond!: (value: Response) => void;
  let requestSignal!: AbortSignal;
  // Deliberately ignores AbortSignal to exercise the engine's own deadline.
  globalThis.fetch = async (_url, init) =>
    await new Promise<Response>((resolve) => {
      respond = resolve;
      requestSignal = init!.signal!;
    });
  const { e, advance } = setup();
  try {
    e.action(
      {
        type: "config",
        config: { joinMode: "free", aiEnabled: true, aiTimeoutSec: 8 },
      },
      "demo",
    );
    e.ingest(chat("1"), "demo");
    e.start("demo");
    const reading = e.sessions.demo.active!;
    const oldContent = structuredClone(reading.content);
    advance(2000);
    advance(3000);
    advance(2000);
    assert.equal(reading.phase, "dealing");
    advance(1001);
    assert.equal(reading.phase, "card1");
    assert.equal(reading.content.source, "fallback");
    assert.match(reading.content.error!, /AI timeout/);
    assert.equal(requestSignal.aborted, true);
    assert.equal(e.signal("demo").aborted, false, "TTS kế tiếp có signal mới");
    respond(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(aiReadingContent(reading)) } }],
        }),
        { status: 200 },
      ),
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(reading.content.source, "fallback");
    assert.equal(reading.phase, "card1");
    assert.deepEqual(
      reading.cards,
      oldContent.cards.map(({ cardId, position, reversed }) => ({
        cardId,
        position,
        reversed,
      })),
    );
  } finally {
    e.close();
    globalThis.fetch = previous.fetch;
    for (const [name, value] of [
      ["AI_API_KEY", previous.key],
      ["AI_BASE_URL", previous.url],
      ["AI_MODEL", previous.model],
    ]) {
      if (value === undefined) delete process.env[name!];
      else process.env[name!] = value;
    }
  }
});
test("10 người cùng nickname ghép đúng ID, avatar, câu hỏi, quà và chỉ 1 lượt mỗi người", () => {
  const { e } = setup();
  for (let i = 0; i < 10; i++) {
    if (i % 2) {
      e.ingest(gift(String(i + 1)), "demo");
      e.ingest(chat(String(i + 1)), "demo");
    } else {
      e.ingest(chat(String(i + 1)), "demo");
      e.ingest(gift(String(i + 1)), "demo");
    }
  }
  const q = e.sessions.demo.queue;
  assert.equal(q.length, 10);
  assert.equal(q.filter((q) => q.status === "ready").length, 10);
  for (let i = 0; i < 10; i++) {
    const item = q.find((q) => q.user.id === String(i + 1))!;
    assert.equal(item.coins, 1);
    assert.equal(item.user.avatar, user(String(i + 1)).profilePictureUrl);
    assert.equal(item.creditIds.length, 1);
    assert.equal(
      e.sessions.demo.credits.find((c) => c.id === item.creditIds[0])?.userId,
      String(i + 1),
    );
  }
  e.close();
});
test("Quà mở lời mời hỏi, vẫn đợi câu hỏi và điều kiện của chế độ quà bắt buộc", () => {
  const { e } = setup();
  e.ingest(chat("1"), "demo");
  assert.equal(e.sessions.demo.queue[0].status, "waiting_condition");
  e.ingest(gift("2"), "demo");
  assert.equal(e.sessions.demo.queue[1].status, "waiting_question");
  e.action({ type: "start" }, "demo");
  assert.equal(e.sessions.demo.active, null);
  assert.equal(e.sessions.demo.intake?.itemId, e.sessions.demo.queue[1].id);
  e.action({ type: "queue-skip", id: e.sessions.demo.queue[1].id }, "demo");
  e.ingest(gift("1"), "demo");
  e.action({ type: "start" }, "demo");
  assert.equal(e.snapshot("demo").session.active?.user.id, "1");
  e.close();
});
test("Combo 1→2→3→final3 chỉ chốt 3, lặp cùng event và final khác ID vẫn không cấp lại", () => {
  const { e } = setup();
  e.ingest(chat("1"), "demo");
  for (const [n, end] of [
    [1, false],
    [2, false],
    [3, false],
    [3, true],
    [3, true],
  ] as [number, boolean][])
    e.ingest(
      gift("1", `combo-${n}-${end}`, {
        giftType: 1,
        repeatCount: n,
        repeatEnd: end,
        groupId: "A",
      }),
      "demo",
    );
  e.ingest(
    gift("1", "another-final", {
      giftType: 1,
      repeatCount: 3,
      repeatEnd: true,
      groupId: "A",
    }),
    "demo",
  );
  assert.equal(e.sessions.demo.credits.length, 1);
  assert.equal(e.sessions.demo.queue[0].coins, 3);
  assert.equal(e.sessions.demo.credits[0].count, 3);
  e.close();
});
test("Hai quà cùng loại/người nhưng khác ID giao dịch được giữ riêng; lặp event không cộng", () => {
  const { e } = setup();
  e.ingest(gift("1", "a"), "demo");
  e.ingest(gift("1", "b"), "demo");
  e.ingest(gift("1", "a"), "demo");
  assert.equal(e.sessions.demo.credits.length, 2);
  assert.equal(e.sessions.demo.queue[0].coins, 2);
  e.close();
});
test("Thiếu giá trị hoặc định danh phải đối soát; không đoán xu, không tự tính quyền lợi", () => {
  const { e } = setup();
  const unknown = gift("1", "x");
  delete unknown.coins;
  e.ingest(unknown, "demo");
  assert.equal(e.sessions.demo.credits[0].coins, null);
  assert.ok(e.sessions.demo.credits[0].review);
  const unreliable = gift("2", "y");
  delete unreliable.id;
  e.ingest(unreliable, "demo");
  assert.ok(e.sessions.demo.credits[1].review);
  assert.equal(e.sessions.demo.queue.length, 2);
  assert.ok(e.sessions.demo.queue.every((item) => item.status === "waiting_question" && item.coins === 0 && item.creditIds.length === 0));
  e.close();
});
test("Quà vượt cửa sổ ghép được giữ để đối soát, không âm thầm dùng hoặc xóa", () => {
  const { e, advance } = setup();
  e.ingest(gift("1"), "demo");
  advance(301_000);
  e.ingest(chat("1"), "demo");
  assert.equal(e.sessions.demo.queue[0].status, "waiting_condition");
  assert.equal(e.sessions.demo.credits.length, 1);
  assert.equal(e.sessions.demo.credits[0].usedBy, undefined);
  assert.ok(e.sessions.demo.credits[0].review);
  e.close();
});
test("Khóa câu hỏi khi đọc; quà trong lúc đọc lưu riêng và chỉ dùng cho yêu cầu mới", () => {
  const { e, advance } = setup();
  e.action({ type: "config", config: { cooldownSec: 0 } }, "demo");
  e.ingest(chat("1"), "demo");
  e.ingest(gift("1"), "demo");
  e.action({ type: "start" }, "demo");
  const original = e.sessions.demo.active!.question;
  e.ingest(
    chat("1", "q2", "Câu hỏi mới không được chèn vào lượt đang đọc"),
    "demo",
  );
  e.ingest(gift("1", "g2"), "demo");
  assert.equal(e.sessions.demo.active?.question, original);
  assert.equal(e.sessions.demo.queue.length, 1);
  assert.equal(e.sessions.demo.credits[1].usedBy, undefined);
  e.action({ type: "skip" }, "demo");
  advance(2000);
  e.ingest(chat("1", "q3", "Sau khi kết thúc tôi nên chú ý điều gì?"), "demo");
  assert.equal(e.sessions.demo.queue.length, 2);
  assert.equal(e.sessions.demo.queue[1].coins, 1);
  assert.notEqual(
    e.sessions.demo.credits[0].usedBy,
    e.sessions.demo.credits[1].usedBy,
  );
  e.close();
});
test("Cập nhật câu hỏi lúc chờ giữ một lượt, duyệt quản trị và giới hạn spam", () => {
  const { e, advance } = setup();
  e.action(
    { type: "config", config: { moderation: true, joinMode: "free" } },
    "demo",
  );
  e.ingest(chat("1"), "demo");
  assert.equal(e.sessions.demo.queue[0].status, "waiting_condition");
  advance(1500);
  e.ingest(
    chat("1", "new", "Tôi nên cải thiện kỹ năng giao tiếp như thế nào?"),
    "demo",
  );
  assert.equal(e.sessions.demo.queue.length, 1);
  assert.match(e.sessions.demo.queue[0].question, /giao tiếp/);
  e.action({ type: "queue-approve", id: e.sessions.demo.queue[0].id }, "demo");
  assert.equal(e.sessions.demo.queue[0].status, "ready");
  e.close();
});
test("FIFO, ưu tiên không cắt lượt đang đọc và thời gian chờ bảo vệ người cũ", () => {
  const { e, advance } = setup();
  e.action(
    {
      type: "config",
      config: { joinMode: "free", priority: true, maxWaitSec: 30 },
    },
    "demo",
  );
  e.ingest(chat("1"), "demo");
  advance(31_000);
  e.ingest(chat("2"), "demo");
  e.ingest(gift("2", "large", { diamondCount: 100 }), "demo");
  e.action({ type: "start" }, "demo");
  assert.equal(e.sessions.demo.active?.user.id, "1");
  e.action({ type: "config", config: { priority: false } }, "demo");
  assert.equal(e.snapshot("demo").session.active?.user.id, "1");
  e.close();
});
test("Ba lá khác nhau, nội dung giữ cardId/vị trí/chiều, refresh snapshot không rút lại", () => {
  const { e } = setup();
  e.ingest(chat("1"), "demo");
  e.ingest(gift("1"), "demo");
  e.action({ type: "start" }, "demo");
  const r = e.sessions.demo.active!;
  assert.equal(new Set(r.cards.map((c) => c.cardId)).size, 3);
  assert.deepEqual(
    r.content.cards.map(({ cardId, position, reversed }) => ({
      cardId,
      position,
      reversed,
    })),
    r.cards,
  );
  for (const c of r.content.cards) {
    assert.ok(words(c.text) >= 45);
    assert.ok(words(c.text) <= r.config.displayWords);
    assert.equal(c.text, c.speech);
  }
  assert.deepEqual(e.snapshot("demo").session.active?.cards, r.cards);
  assert.deepEqual(e.snapshot("demo").session.active?.cards, r.cards);
  e.close();
});
test("Pause/resume/replay không đổi lá, generation thay đổi, skip hủy signal cũ", () => {
  const { e, advance } = setup();
  e.ingest(chat("1"), "demo");
  e.ingest(gift("1"), "demo");
  e.action({ type: "start" }, "demo");
  const cards = structuredClone(e.sessions.demo.active!.cards);
  const id = e.sessions.demo.active!.id;
  const old = e.signal("demo");
  advance(500);
  e.action({ type: "pause" }, "demo");
  assert.ok(old.aborted);
  advance(100_000);
  assert.equal(e.sessions.demo.active?.phase, "locking");
  e.action({ type: "resume" }, "demo");
  assert.deepEqual(e.sessions.demo.active?.cards, cards);
  assert.equal(e.sessions.demo.active?.id, id);
  e.action({ type: "replay" }, "demo");
  assert.deepEqual(e.sessions.demo.active?.cards, cards);
  const resumed = e.signal("demo");
  e.action({ type: "skip" }, "demo");
  assert.ok(resumed.aborted);
  assert.equal(e.sessions.demo.active, null);
  e.close();
});
test("Full offline state machine kết thúc không cần TikFinity/AI/TTS", () => {
  const { e, advance } = setup();
  e.action({ type: "demo", scenario: "full" }, "demo");
  assert.ok(e.sessions.demo.active);
  const seen: string[] = [];
  while (e.sessions.demo.active) {
    seen.push(e.sessions.demo.active.phase);
    advance(200_000);
  }
  assert.deepEqual(seen, [
    "locking",
    "shuffling",
    "dealing",
    "card1",
    "card2",
    "card3",
    "summary",
    "complete",
  ]);
  assert.equal(e.sessions.demo.queue[0].status, "completed");
  assert.equal(e.sessions.live.queue.length, 0);
  e.close();
});
test("Tim tăng thêm chống lặp và mỗi mốc chỉ mở một lượt, giữ dư qua pending/cooldown", () => {
  const { e, advance } = setup();
  e.action({ type: "config", config: { communityCooldownSec: 0 } }, "demo");
  const like = normalizeEnvelope({
    event: "like",
    data: { msgId: "l1", likeCount: 6150 },
  });
  e.ingest(like, "demo");
  e.ingest(like, "demo");
  assert.equal(e.sessions.demo.hearts.total, 6150);
  assert.equal(e.sessions.demo.queue.length, 1);
  assert.equal(e.sessions.demo.hearts.milestones, 1);
  e.action({ type: "start" }, "demo");
  e.action({ type: "skip" }, "demo");
  advance(1000);
  assert.equal(e.sessions.demo.hearts.milestones, 2);
  assert.equal(e.sessions.demo.queue.length, 2);
  assert.equal(
    e.sessions.demo.hearts.total - e.sessions.demo.hearts.milestones * 3000,
    150,
  );
  e.close();
});
test("Tổng tim tích lũy dùng baseline và reset khi đổi room; roomUser không tạo người", () => {
  const { e } = setup();
  e.ingest(
    normalizeEnvelope({
      event: "like",
      data: { msgId: "l1", totalLikeCount: 10000, roomId: "room-a" },
    }),
    "demo",
  );
  e.ingest(
    normalizeEnvelope({
      event: "like",
      data: { msgId: "l2", totalLikeCount: 13100, roomId: "room-a" },
    }),
    "demo",
  );
  assert.equal(e.sessions.demo.hearts.total, 3100);
  e.ingest(
    normalizeEnvelope({
      event: "like",
      data: { msgId: "l3", totalLikeCount: 13100, roomId: "room-a" },
    }),
    "demo",
  );
  assert.equal(e.sessions.demo.hearts.total, 3100);
  e.ingest(
    normalizeEnvelope({
      event: "like",
      data: { msgId: "l4", totalLikeCount: 40000, roomId: "room-b" },
    }),
    "demo",
  );
  assert.equal(e.sessions.demo.hearts.total, 0);
  const count = e.sessions.demo.queue.length;
  e.ingest(
    normalizeEnvelope({
      event: "roomUser",
      data: { total: 999, ranks: [user("8")] },
    }),
    "demo",
  );
  assert.equal(e.sessions.demo.queue.length, count);
  e.close();
});
test("Restart khôi phục queue, credit/dedupe, card cố định và paused thay vì tự đọc lại", () => {
  const { e, store } = setup();
  e.ingest(chat("1"), "demo");
  e.ingest(gift("1"), "demo");
  e.action({ type: "start" }, "demo");
  const cards = structuredClone(e.sessions.demo.active!.cards);
  const second = new Engine(store, { now: () => 1_002_000, rng: () => 0 });
  assert.ok(second.sessions.demo.active?.paused);
  assert.deepEqual(second.sessions.demo.active?.cards, cards);
  second.ingest(gift("1"), "demo");
  assert.equal(second.sessions.demo.credits.length, 1);
  assert.equal(second.sessions.demo.queue.length, 1);
  second.action({ type: "skip" }, "demo");
  second.close();
});
test("Hủy lượt giữ credit đã dùng; hoàn credit là thao tác tách biệt", () => {
  const { e } = setup();
  e.ingest(chat("1"), "demo");
  e.ingest(gift("1"), "demo");
  const q = e.sessions.demo.queue[0],
    c = e.sessions.demo.credits[0];
  assert.throws(() => e.action({ type: "credit-refund", id: c.id }, "demo"));
  e.action({ type: "queue-skip", id: q.id }, "demo");
  assert.equal(c.usedBy, q.id);
  e.action({ type: "credit-refund", id: c.id }, "demo");
  assert.equal(c.usedBy, undefined);
  assert.equal(c.refunded, true);
  e.close();
});
test("Chỉ một audio owner toàn app, tab preview không tự nhận quyền", () => {
  const { e } = setup();
  assert.equal(e.audioOwners.demo, null);
  assert.equal(e.setAudioOwner("demo", "owner-1"), true);
  assert.equal(e.setAudioOwner("demo", "preview-2"), false);
  assert.equal(e.setAudioOwner("live", "live-3"), false);
  e.setAudioOwner("demo", null);
  assert.equal(e.setAudioOwner("live", "live-3"), true);
  e.close();
});

test("Chuyển nguồn cùng phiên cần thao tác rõ ràng và giữ thời gian chuẩn bị cho overlay", () => {
  const { e, advance } = setup();
  try {
    e.action({ type: "demo", scenario: "full" }, "demo");
    for (let index = 0; index < 3; index++) e.advance("demo");
    const reading = e.sessions.demo.active!;
    assert.equal(reading.phase, "card1");
    const signature = [reading.id, reading.phase, reading.generation] as const;
    assert.equal(e.setAudioOwner("demo", "admin-audio"), true);
    e.audioStart("demo", ...signature);
    for (let second = 0; second < 30; second++) {
      e.audioHeartbeat("demo", ...signature);
      advance(1000);
    }
    e.audioProgress("demo", {
      readingId: reading.id,
      phase: reading.phase,
      generation: reading.generation,
      charIndex: 1,
      timing: "boundary",
    });
    assert.ok(e.snapshot("demo").audioSegment);
    assert.equal(e.setAudioOwner("demo", "overlay-audio"), false);
    assert.equal(e.setAudioOwner("live", "live-overlay", true), false);
    assert.equal(e.setAudioOwner("live", "admin-audio", true), false);
    assert.equal(e.setAudioOwner("demo", "overlay-audio", true), true);
    assert.equal(e.snapshot("demo").audioOwner, "overlay-audio");
    assert.equal(e.snapshot("live").audioOwner, null);
    assert.equal(e.snapshot("demo").audioSegment, undefined);
    assert.equal(e.snapshot("demo").audioActive, true);
    assert.equal(reading.phase, "card1");
    advance(9999);
    assert.equal(reading.phase, "card1");
    advance(1);
    assert.equal(
      reading.phase,
      "card2",
      "Nguồn mới không được giữ lượt vô hạn nếu không phát",
    );
  } finally {
    e.close();
  }
});
test("Config validate, không xuất secret, quy tắc đang đọc giữ snapshot cũ", () => {
  const { e } = setup();
  assert.throws(() => validateConfig({ heartGoal: 0 }, DEFAULT_CONFIG));
  assert.throws(() =>
    validateConfig({ characterAsset: "javascript:alert(1)" }, DEFAULT_CONFIG),
  );
  assert.throws(() =>
    validateConfig({ characterAsset: "/assets/../data/x" }, DEFAULT_CONFIG),
  );
  e.ingest(chat("1"), "demo");
  e.ingest(gift("1"), "demo");
  e.action({ type: "start" }, "demo");
  e.action(
    {
      type: "config",
      config: { minCoins: 99, durations: { card: 50 }, apiKey: "secret" },
    },
    "demo",
  );
  assert.equal(e.config.minCoins, 99);
  assert.equal(e.sessions.demo.active?.config.minCoins, 1);
  assert.equal(e.sessions.demo.active?.config.durations.card, 24);
  assert.equal(JSON.stringify(e.config).includes("secret"), false);
  e.close();
});

test("Lời giải đầy đủ là mặc định, giữ cấu hình hợp lệ và chỉ áp dụng thay đổi cho lượt mới", () => {
  assert.equal(DEFAULT_CONFIG.displayWords, 65);
  assert.equal(DEFAULT_CONFIG.summaryWords, 50);
  const shortest = validateConfig({ displayWords: 45, summaryWords: 35 }, DEFAULT_CONFIG);
  assert.equal(shortest.displayWords, 45);
  assert.equal(shortest.summaryWords, 35);
  for (const patch of [
    { displayWords: 44 }, { displayWords: 71 },
    { summaryWords: 34 }, { summaryWords: 56 },
  ]) assert.throws(() => validateConfig(patch, DEFAULT_CONFIG));

  const store = new Store(":memory:");
  store.save({
    config: { ...DEFAULT_CONFIG, displayWords: 45, summaryWords: 35 },
    sessions: { demo: blankSession(), live: blankSession() },
  });
  const engine = new Engine(store, { rng: () => 0 });
  try {
    assert.equal(engine.config.displayWords, 45);
    assert.equal(engine.config.summaryWords, 35);
    engine.action({ type: "demo", scenario: "full" }, "demo");
    const old = engine.sessions.demo.active!;
    engine.action({ type: "config", config: { displayWords: 65, summaryWords: 50 } }, "demo");
    assert.equal(old.config.displayWords, 45);
    assert.equal(old.config.summaryWords, 35);
    engine.action({ type: "skip" }, "demo");
    engine.action({ type: "start" }, "demo");
    assert.notEqual(engine.sessions.demo.active!.id, old.id);
    assert.equal(engine.sessions.demo.active!.config.displayWords, 65);
    assert.equal(engine.sessions.demo.active!.config.summaryWords, 50);
  } finally {
    engine.close();
  }
});

test("Cấu hình ngắn đã lưu được nâng về lời giải đầy đủ, còn lượt cũ giữ nguyên nội dung đã chốt", () => {
  const seed = new Engine(undefined, { rng: () => 0 });
  seed.action({ type: "demo", scenario: "full" }, "demo");
  const sessions = structuredClone(seed.sessions);
  seed.close();
  const old = sessions.demo.active!;
  old.config.displayWords = 30;
  old.config.summaryWords = 25;
  const shortText = "Bạn nên làm rõ điều mình mong muốn trong mối quan hệ. Hãy trò chuyện bình tĩnh và cùng chọn một việc nhỏ để cải thiện.";
  old.content.cards = old.content.cards.map((card) => ({ ...card, text: shortText, speech: shortText }));
  old.content.summary = "Ba lá bài gợi ý bạn cân bằng cảm xúc, nói rõ nhu cầu và cùng chọn một thay đổi vừa sức.";
  const lockedContent = structuredClone(old.content);
  const store = new Store(":memory:");
  store.save({ config: { ...DEFAULT_CONFIG, displayWords: 30, summaryWords: 25 }, sessions });
  const engine = new Engine(store, { rng: () => 0 });
  try {
    assert.equal(engine.config.displayWords, 65);
    assert.equal(engine.config.summaryWords, 50);
    const restored = engine.sessions.demo.active!;
    assert.equal(restored.id, old.id);
    assert.equal(restored.paused, true);
    assert.equal(restored.config.displayWords, 30);
    assert.equal(restored.config.summaryWords, 25);
    assert.deepEqual(restored.content, lockedContent);
    engine.action({ type: "skip" }, "demo");
    engine.action({ type: "start" }, "demo");
    const next = engine.sessions.demo.active!;
    assert.notEqual(next.id, old.id);
    assert.equal(next.config.displayWords, 65);
    assert.equal(next.config.summaryWords, 50);
    assert.ok(next.content.cards.every((card) => words(card.text) >= 45 && words(card.text) <= 65));
    assert.ok(words(next.content.summary) >= 35 && words(next.content.summary) <= 50);
  } finally {
    engine.close();
  }
});

test("Âm lượng hiệu ứng độc lập với giọng đọc và giữ lựa chọn nhạc khi phục hồi cấu hình cũ", () => {
  const configured = validateConfig(
    { speechVolume: 0, sfxVolume: 0.8, music: true, musicVolume: 0.16 },
    DEFAULT_CONFIG,
  );
  assert.equal(configured.speechVolume, 0);
  assert.equal(configured.sfxVolume, 0.8);
  assert.equal(configured.music, true);
  for (const sfxVolume of [-0.01, 1.01, NaN, "0.5"])
    assert.throws(() => validateConfig({ sfxVolume }, DEFAULT_CONFIG));
  assert.equal(validateConfig({ sfxVolume: 0 }, DEFAULT_CONFIG).sfxVolume, 0);
  assert.equal(validateConfig({ sfxVolume: 1 }, DEFAULT_CONFIG).sfxVolume, 1);

  const { sfxVolume: _omitted, ...legacyConfig } = DEFAULT_CONFIG;
  const store = new Store(":memory:");
  store.save({
    config: {
      ...legacyConfig,
      music: false,
      musicVolume: 0.08,
    } as typeof DEFAULT_CONFIG,
    sessions: { demo: blankSession(), live: blankSession() },
  });
  const restored = new Engine(store);
  try {
    assert.equal(restored.config.sfxVolume, 0.65);
    assert.equal(restored.config.music, false);
    assert.equal(restored.config.musicVolume, 0.08);
  } finally {
    restored.close();
  }
});
test("AI validator không cho thay lá/chiều/vị trí dù comment yêu cầu, fallback vẫn cùng lá", () => {
  const { e } = setup();
  e.ingest(chat("1"), "demo");
  e.ingest(gift("1"), "demo");
  e.action({ type: "start" }, "demo");
  const r = e.sessions.demo.active!;
  const content = aiReadingContent(r);
  const fake = structuredClone(content);
  fake.cards[0].cardId = "fake";
  assert.throws(() => validateAI(fake, r));
  const valid = validateAI(content, r);
  assert.deepEqual(
    valid.cards.map(({ cardId, position, reversed }) => ({
      cardId,
      position,
      reversed,
    })),
    r.cards,
  );
  e.action({ type: "demo", scenario: "ai-timeout" }, "demo");
  assert.equal(e.sessions.demo.active?.content.source, "fallback");
  e.close();
});
test("Đổi mốc tim chỉ dùng phần dư, không tái dùng tim đã mở lượt chung", () => {
  const { e } = setup();
  e.action({ type: "config", config: { communityCooldownSec: 0 } }, "demo");
  e.ingest(
    normalizeEnvelope({
      event: "like",
      data: { msgId: "hearts-1", likeCount: 3150 },
    }),
    "demo",
  );
  assert.equal(e.sessions.demo.hearts.consumed, 3000);
  e.action({ type: "queue-skip", id: e.sessions.demo.queue[0].id }, "demo");
  e.action({ type: "config", config: { heartGoal: 1000 } }, "demo");
  assert.equal(e.sessions.demo.hearts.milestones, 1);
  assert.equal(
    e.sessions.demo.hearts.total - e.sessions.demo.hearts.consumed!,
    150,
  );
  e.close();
});
test("Frame tổng tim đến muộn không làm giảm high-water rồi cộng lại", () => {
  const { e } = setup();
  for (const [i, total] of [100, 110, 100, 110].entries())
    e.ingest(
      normalizeEnvelope({
        event: "like",
        data: { msgId: `h${i}`, totalLikeCount: total },
      }),
      "demo",
    );
  assert.equal(e.sessions.demo.hearts.total, 10);
  e.close();
});
test("Phụ đề chỉ nhận đúng đoạn hiện tại từ audio owner, pause/generation không giữ đoạn cũ", () => {
  const { e } = setup();
  e.action({ type: "demo", scenario: "full" }, "demo");
  for (let i = 0; i < 3; i++) e.advance("demo");
  const r = e.sessions.demo.active!;
  assert.equal(r.phase, "card1");
  const text = e.currentText("demo");
  e.setAudioSegment("demo", {
    readingId: r.id,
    phase: r.phase,
    generation: r.generation,
    text: text.slice(0, 80),
    index: 0,
  });
  assert.equal(e.snapshot("demo").audioSegment?.text, text.slice(0, 80));
  e.setAudioSegment("demo", {
    readingId: r.id,
    phase: r.phase,
    generation: r.generation,
    text: "Nội dung không thuộc lời đọc",
    index: 0,
  });
  assert.equal(e.snapshot("demo").audioSegment?.text, text.slice(0, 80));
  e.action({ type: "pause" }, "demo");
  assert.equal(e.snapshot("demo").audioSegment, undefined);
  e.action({ type: "resume" }, "demo");
  assert.equal(e.snapshot("demo").audioSegment, undefined);
  assert.throws(() => e.action({ type: "new-session" }, "demo"));
  assert.deepEqual(e.snapshot("demo").session.seen, {});
  assert.ok(Object.keys(e.sessions.demo.seen).length > 0);
  e.close();
});
test("Khôi phục hàng chờ tự động cũng giữ yên tới khi admin Bắt đầu", () => {
  const { e, store } = setup();
  e.ingest(chat("1"), "demo");
  e.ingest(gift("1"), "demo");
  e.action({ type: "config", config: { autoRun: true } }, "live");
  e.action({ type: "pause" }, "demo");
  e.action({ type: "skip" }, "demo");
  e.ingest(chat("2"), "demo");
  e.ingest(gift("2"), "demo");
  e.action({ type: "pause" }, "demo");
  const state = store.load()!;
  state.sessions.demo.active = null;
  state.sessions.demo.queue.find((q) => q.user.id === "2")!.status = "ready";
  store.save(state);
  const recovered = new Engine(store, { now: () => 1_500_000, rng: () => 0 });
  recovered.tick();
  assert.equal(recovered.sessions.demo.active, null);
  recovered.action({ type: "start" }, "demo");
  assert.equal(recovered.snapshot("demo").session.active?.user.id, "2");
  recovered.close();
});
