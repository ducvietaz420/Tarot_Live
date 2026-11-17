import test from "node:test";
import assert from "node:assert/strict";
import { blankSession, DEFAULT_CONFIG, Engine } from "../server/engine.ts";
import { Store } from "../server/store.ts";
import { normalizeEnvelope } from "../server/tikfinity.ts";
import type { Mode } from "../shared/types.ts";

function fixture() {
  let now = 1_000_000;
  let draws = 0;
  let store = new Store(":memory:");
  let engine = new Engine(store, { now: () => now, rng: () => { draws++; return 0; } });
  let sequence = 0;
  return {
    current: () => engine,
    active: () => engine.sessions.live.active,
    now: () => now,
    draws: () => draws,
    chat(userId: string, comment: string, mode: Mode = "live", extra: Record<string, unknown> = {}) {
      engine.ingest(normalizeEnvelope({ event: "chat", data: {
        userId, nickname: "Cùng tên", msgId: `chat-${++sequence}`, comment, ...extra,
      } }), mode);
    },
    gift(userId: string, mode: Mode = "live", extra: Record<string, unknown> = {}) {
      engine.ingest(normalizeEnvelope({ event: "gift", data: {
        userId, nickname: "Cùng tên", msgId: `gift-${++sequence}`,
        giftId: "rose", giftName: "Hoa hồng", giftType: 0, repeatCount: 1,
        repeatEnd: true, diamondCount: 1, ...extra,
      } }), mode);
    },
    tick(ms: number) { now += ms; engine.tick(); },
    restart() {
      const saved = structuredClone(store.load()!);
      engine.close();
      store = new Store(":memory:");
      store.save(saved);
      engine = new Engine(store, { now: () => now, rng: () => { draws++; return 0; } });
      return engine;
    },
    close: () => engine.close(),
  };
}

test("Bình luận tarot mở lời mời chọn chủ đề, chỉ rút bài sau câu hỏi cụ thể", (t) => {
  const f = fixture(); t.after(f.close);
  const e = f.current();
  assert.equal(e.config.autoRun, true);
  assert.equal(e.config.joinMode, "gift_priority");
  f.chat("viewer-1", "tarot");
  const session = e.sessions.live;
  const item = session.queue[0];
  assert.equal(item.status, "waiting_question");
  assert.equal(item.question, "");
  assert.equal(session.intake?.itemId, item.id);
  assert.equal(session.intake?.deadline, f.now() + 60_000);
  assert.equal(session.active, null);
  assert.equal(f.draws(), 0);
  f.chat("viewer-1", "Tôi muốn xem về tình duyên");
  assert.equal(item.topic, "Tình duyên");
  assert.equal(item.topicChosen, true);
  assert.equal(item.question, "");
  assert.equal(session.active, null);
  assert.equal(f.draws(), 0);
  f.chat("viewer-1", "Tôi và bạn gái có ở bên nhau dài lâu không?");
  assert.equal(f.active()?.user.id, "viewer-1");
  assert.equal(f.active()?.topic, "Tình duyên");
  assert.equal(f.active()?.question, "Tôi và bạn gái có ở bên nhau dài lâu không?");
  assert.equal(f.active()?.phase, "locking");
  assert.equal(f.active()?.cards.length, 3);
  assert.equal(session.intake, undefined);
  assert.ok(f.draws() > 0);
});

test("Một câu trả lời đủ chủ đề và vấn đề bắt đầu trải bài ngay", (t) => {
  const f = fixture(); t.after(f.close);
  f.chat("viewer-1", "tarot");
  f.chat("viewer-1", "Tôi muốn xem về tình duyên, Tôi muốn biết tôi và bạn gái của tôi có ở bên nhau dài lâu không?");
  const reading = f.current().sessions.live.active;
  assert.equal(reading?.topic, "Tình duyên");
  assert.match(reading!.question, /tôi và bạn gái/iu);
  assert.equal(reading?.phase, "locking");
});

test("Người khác cùng nickname và phiên DEMO không thể trả lời thay người được gọi", (t) => {
  const f = fixture(); t.after(f.close);
  f.chat("selected", "tarot");
  const session = f.current().sessions.live;
  const selectedId = session.intake!.itemId;
  f.chat("stranger", "Tôi muốn xem về tình duyên, tôi nên làm gì với mối quan hệ này?");
  f.chat("selected", "Tình duyên: Tôi nên nói gì với bạn gái?", "demo");
  f.chat("stranger", "Xin chào mọi người");
  assert.equal(session.queue.length, 1);
  assert.equal(session.intake?.itemId, selectedId);
  assert.equal(session.queue[0].question, "");
  assert.equal(session.active, null);
  f.chat("stranger", "tarot");
  assert.equal(session.queue.length, 2);
  assert.equal(session.intake?.itemId, selectedId);
});

test("Quà chưa biết giá vẫn vào hàng chờ nhưng không tự đoán số xu", (t) => {
  const f = fixture(); t.after(f.close);
  f.gift("gifter", "live", { diamondCount: undefined });
  const session = f.current().sessions.live;
  const item = session.queue[0];
  assert.equal(item.user.id, "gifter");
  assert.equal(item.gifted, true);
  assert.equal(item.coins, 0);
  assert.equal(session.credits[0]?.coins, null);
  assert.equal(session.intake?.itemId, item.id);
  assert.equal(session.active, null);
  assert.equal(f.draws(), 0);
});

test("Người tặng quà được gọi trước khi rảnh, không chen ngang lời mời đang mở", (t) => {
  const f = fixture(); t.after(f.close);
  const e = f.current();
  e.action({ type: "config", config: { autoRun: false } }, "live");
  f.chat("free", "tarot");
  f.gift("gifter");
  assert.equal(e.sessions.live.active, null);
  e.action({ type: "start" }, "live");
  const item = e.sessions.live.queue.find((q) => q.id === e.sessions.live.intake?.itemId);
  assert.equal(item?.user.id, "gifter");
  f.gift("later-gifter", "live", { diamondCount: 99 });
  assert.equal(e.sessions.live.intake?.itemId, item?.id);
  f.chat("gifter", "Công việc: Tôi nên chuyển việc vào tháng tới không?");
  const reading = f.active();
  assert.equal(reading?.user.id, "gifter");
  f.gift("later-gifter", "live", { diamondCount: 100 });
  assert.equal(f.active()?.id, reading?.id);
});

test("Quà lặp và tiến trình combo không tạo nhiều lượt cho cùng tài khoản", (t) => {
  const f = fixture(); t.after(f.close);
  f.gift("gifter", "live", { msgId: "same-gift" });
  f.gift("gifter", "live", { msgId: "same-gift" });
  for (const [repeatCount, repeatEnd] of [[1, false], [2, false], [3, true], [3, true]] as const)
    f.gift("gifter", "live", { giftType: 1, repeatCount, repeatEnd, groupId: "combo-1" });
  const session = f.current().sessions.live;
  assert.equal(session.queue.length, 1);
  assert.equal(session.credits.reduce((sum, c) => sum + (c.coins || 0), 0), 4);
  assert.equal(session.intake?.itemId, session.queue[0].id);
});

test("Hết thời gian trả lời chủ đề bỏ qua người vắng và gọi người kế tiếp", (t) => {
  const f = fixture(); t.after(f.close);
  f.chat("absent", "tarot");
  f.chat("next", "tarot");
  f.tick(60_000);
  const session = f.current().sessions.live;
  assert.equal(session.queue.find((q) => q.user.id === "absent")?.status, "skipped");
  assert.equal(session.queue.find((q) => q.id === session.intake?.itemId)?.user.id, "next");
  assert.equal(session.intake?.deadline, f.now() + 60_000);
  assert.equal(session.active, null);
});

test("Khôi phục giữ lời mời và hàng chờ đến khi quản trị bấm bắt đầu", (t) => {
  const f = fixture(); t.after(f.close);
  f.chat("viewer", "tarot");
  const itemId = f.current().sessions.live.intake!.itemId;
  const e = f.restart();
  f.tick(120_000);
  assert.equal(e.sessions.live.active, null);
  assert.equal(e.sessions.live.queue.find((q) => q.id === itemId)?.status, "waiting_question");
  e.action({ type: "start" }, "live");
  assert.equal(e.sessions.live.intake?.itemId, itemId);
  assert.equal(e.sessions.live.intake?.deadline, f.now() + 60_000);
  f.chat("viewer", "Gia đình: Tôi nên giải quyết bất đồng với bố mẹ thế nào?");
  assert.equal(f.active()?.user.id, "viewer");
});

test("Bình luận từ phòng khác không điền câu hỏi của lời mời hiện tại", (t) => {
  const f = fixture(); t.after(f.close);
  f.chat("viewer", "tarot", "live", { roomId: "room-a" });
  const session = f.current().sessions.live;
  f.chat("viewer", "Tình duyên: Tôi nên nói gì để hiểu bạn gái hơn?", "live", { roomId: "room-b" });
  assert.equal(session.active, null);
  assert.equal(session.queue[0].question, "");
  f.chat("viewer", "Tình duyên: Tôi nên nói gì để hiểu bạn gái hơn?", "live", { roomId: "room-a" });
  assert.equal(f.active()?.user.id, "viewer");
});

test("Nâng cấu hình cũ một lần, giữ âm thanh và AI, lần khởi động sau giữ lựa chọn thủ công", (t) => {
  const previousKey = process.env.AI_API_KEY;
  const key = "migration-fixture-private-key";
  process.env.AI_API_KEY = key;
  t.after(() => {
    if (previousKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = previousKey;
  });
  const oldConfig = structuredClone(DEFAULT_CONFIG);
  delete oldConfig.conversationVersion;
  Object.assign(oldConfig, {
    command: "!tarot", joinMode: "gift_question", priority: false, autoRun: false,
    followUpWindowSec: 120, aiEnabled: true, aiModel: "configured-model",
    voice: "existing-voice", speechRate: 1.1, speechVolume: 0.6,
    music: false, musicVolume: 0.23, sfxVolume: 0.42,
    durations: { ...oldConfig.durations, shuffling: 3, dealing: 2 },
  });
  let store = new Store(":memory:");
  store.save({ config: oldConfig, sessions: { demo: blankSession(), live: blankSession() } });
  let engine = new Engine(store);
  t.after(() => engine.close());
  assert.equal(engine.config.conversationVersion, 2);
  assert.equal(engine.config.command, "tarot");
  assert.equal(engine.config.joinMode, "gift_priority");
  assert.equal(engine.config.priority, true);
  assert.equal(engine.config.autoRun, true);
  assert.equal(engine.config.followUpWindowSec, 30);
  assert.equal(engine.config.durations.shuffling, 5);
  assert.equal(engine.config.durations.dealing, 5);
  for (const name of ["aiEnabled", "aiModel", "voice", "speechRate", "speechVolume", "music", "musicVolume", "sfxVolume"] as const)
    assert.equal(engine.config[name], oldConfig[name], name);
  assert.equal(process.env.AI_API_KEY, key);
  assert.ok(!JSON.stringify(engine.snapshot("live")).includes(key));
  engine.action({ type: "config", config: { autoRun: false, priority: false, durations: { shuffling: 7, dealing: 6 } } }, "live");
  const saved = structuredClone(store.load()!);
  engine.close();
  store = new Store(":memory:");
  store.save(saved);
  engine = new Engine(store);
  assert.equal(engine.config.conversationVersion, 2);
  assert.equal(engine.config.autoRun, false);
  assert.equal(engine.config.priority, false);
  assert.equal(engine.config.durations.shuffling, 7);
  assert.equal(engine.config.durations.dealing, 6);
  assert.equal(process.env.AI_API_KEY, key);
});

test("Nhắc lại cùng chủ đề không kéo dài vô hạn khung chờ câu hỏi", (t) => {
  const f = fixture(); t.after(f.close);
  f.chat("viewer", "tarot");
  f.tick(10_000);
  f.chat("viewer", "Tôi muốn xem về tình duyên");
  const session = f.current().sessions.live;
  const deadline = session.intake!.deadline;
  assert.equal(deadline, f.now() + 60_000);
  f.tick(20_000);
  f.chat("viewer", "Tình duyên ạ");
  assert.equal(session.intake?.deadline, deadline);
  f.tick(40_000);
  assert.equal(session.queue[0].status, "skipped");
  assert.equal(session.intake, undefined);
});

test("Quà thiếu roomId ghép đúng người trong phòng hiện tại", (t) => {
  const f = fixture(); t.after(f.close);
  f.chat("viewer", "tarot", "live", { roomId: "current-room" });
  const session = f.current().sessions.live;
  const itemId = session.queue[0].id;
  f.gift("viewer");
  assert.equal(session.queue.length, 1);
  assert.equal(session.queue[0].id, itemId);
  assert.equal(session.queue[0].roomId, "current-room");
  assert.equal(session.queue[0].gifted, true);
  assert.equal(session.credits[0].roomId, "current-room");
  assert.equal(session.credits[0].usedBy, itemId);
  assert.equal(session.queue[0].coins, 1);
});

test("Nhập file cấu hình cũ trong phiên mới vẫn nâng luồng, bình luận tarot xem được không cần quà", (t) => {
  const f = fixture(); t.after(f.close);
  const e = f.current();
  assert.equal(e.config.conversationVersion, 2);
  const imported = structuredClone(DEFAULT_CONFIG);
  delete imported.conversationVersion;
  Object.assign(imported, {
    command: "!tarot", joinMode: "gift_question", autoRun: false, priority: false,
    instruction: "Bình luận {command} chủ đề | câu hỏi", followUpWindowSec: 120,
    durations: { ...imported.durations, shuffling: 3, dealing: 2 },
  });
  e.action({ type: "config", config: imported }, "live");
  assert.equal(e.config.conversationVersion, 2);
  assert.equal(e.config.command, "tarot");
  assert.equal(e.config.autoRun, true);
  assert.equal(e.config.joinMode, "gift_priority");
  assert.equal(e.config.durations.shuffling, 5);
  assert.equal(e.config.durations.dealing, 5);
  f.chat("viewer", "tarot");
  assert.equal(e.sessions.live.queue[0].user.id, "viewer");
  assert.equal(e.sessions.live.intake?.itemId, e.sessions.live.queue[0].id);
  f.chat("viewer", "Công việc: Tôi nên thay đổi việc làm vào lúc nào?");
  assert.equal(f.active()?.user.id, "viewer");
  assert.equal(f.active()?.phase, "locking");
  assert.equal(e.sessions.live.credits.length, 0);
});
