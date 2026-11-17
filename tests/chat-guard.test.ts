import test from "node:test";
import assert from "node:assert/strict";
import {
  CHAT_REPLAY_WINDOW_MS,
  COMPLETED_QUESTION_REPEAT_WINDOW_MS,
  completedQuestionRepeat,
  expiredChatReplayKeys,
  missingIdChatReplay,
  normalizeChatText,
} from "../server/chat-guard.ts";
import type { NormalizedEvent } from "../shared/types.ts";

const event = (patch: Partial<NormalizedEvent> = {}): NormalizedEvent => ({
  type: "chat",
  user: { id: "account-1", name: "Minh Anh" },
  roomId: "room-1",
  comment: "!tarot công việc | Tôi nên tập trung điều gì?",
  issues: [],
  ...patch,
});

const attempt = {
  userId: "account-1",
  roomId: "room-1",
  topic: "Công việc",
  question: "Tôi nên tập trung điều gì?",
};

const completed = (patch = {}) => ({
  id: "completed-1",
  user: { id: attempt.userId, name: "Minh Anh" },
  roomId: attempt.roomId,
  topic: attempt.topic,
  question: attempt.question,
  status: "completed",
  updatedAt: 10_000,
  ...patch,
});

test("Chat thiếu msgId có hash theo ID người/phòng, chặn phát lại chỉ trong 5 giây", () => {
  const seen: Record<string, number> = {};
  const first = missingIdChatReplay(event(), seen, 1000)!;
  assert.equal(first.duplicate, false);
  assert.ok(!first.key.includes("account-1") && !first.key.includes("Tôi"));
  seen[first.key] = 1000;
  assert.equal(missingIdChatReplay(event(), seen, 1000 + CHAT_REPLAY_WINDOW_MS - 1)?.duplicate, true);
  assert.equal(missingIdChatReplay(event(), seen, 1000 + CHAT_REPLAY_WINDOW_MS)?.duplicate, false);
  assert.equal(seen[first.key], 1000, "Kiểm tra không tự kéo dài cửa sổ khi có frame lặp");
});

test("NFC, hoa/thường và khoảng trắng tương đương không lách hash hoặc câu hỏi đã hoàn tất", () => {
  const content = "!TAROT  CÔNG VIỆC | TÔI NÊN TẬP TRUNG ĐIỀU GÌ?".normalize("NFD");
  assert.equal(normalizeChatText(content), normalizeChatText(event().comment!));
  const first = missingIdChatReplay(event(), {}, 1000)!;
  const seen = { [first.key]: 1000 };
  assert.equal(missingIdChatReplay(event({ comment: " \n" + content + "\t " }), seen, 1001)?.duplicate, true);
  assert.equal(completedQuestionRepeat([completed()], {
    ...attempt,
    topic: " CÔNG  VIỆC ".normalize("NFD"),
    question: "\n TÔI NÊN   TẬP TRUNG ĐIỀU GÌ? ".normalize("NFD"),
  }, 10_001)?.id, "completed-1");
});

test("Không gộp hai ID cùng nickname, hai phòng, dấu tiếng Việt hoặc câu hỏi khác", () => {
  const first = missingIdChatReplay(event(), {}, 1000)!;
  const seen = { [first.key]: 1000 };
  for (const changed of [
    event({ user: { id: "account-2", name: "Minh Anh" } }),
    event({ roomId: "room-2" }),
    event({ comment: "!tarot công việc | Tôi nên nghỉ điều gì?" }),
  ]) assert.equal(missingIdChatReplay(changed, seen, 1001)?.duplicate, false);
  assert.notEqual(normalizeChatText("nghỉ"), normalizeChatText("nghĩ"));
  for (const changed of [
    { ...attempt, userId: "account-2" },
    { ...attempt, roomId: "room-2" },
    { ...attempt, topic: "Gia đình" },
    { ...attempt, question: "Tôi nên trao đổi với ai?" },
  ]) assert.equal(completedQuestionRepeat([completed()], changed, 10_001), undefined);
});

test("Có msgId, thiếu ID người hoặc không phải chat không dùng fingerprint thay thế", () => {
  for (const changed of [
    event({ id: "real-msg-id" }),
    event({ user: undefined }),
    event({ type: "gift" }),
    event({ comment: "  \n" }),
  ]) assert.equal(missingIdChatReplay(changed, {}, 1000), undefined);
  const first = missingIdChatReplay(event({ roomId: undefined }), {}, 1000, "room-1")!;
  assert.equal(first.key, missingIdChatReplay(event(), {}, 1000)!.key);
});

test("Lệnh y hệt sau khi hoàn tất bị chặn 2 phút, rồi được phép tạo lượt mới", () => {
  const history = [completed()];
  assert.equal(completedQuestionRepeat(history, attempt, 10_001)?.id, "completed-1");
  assert.equal(completedQuestionRepeat(history, attempt, 10_000 + COMPLETED_QUESTION_REPEAT_WINDOW_MS - 1)?.id, "completed-1");
  assert.equal(completedQuestionRepeat(history, attempt, 10_000 + COMPLETED_QUESTION_REPEAT_WINDOW_MS), undefined);
  assert.equal(history[0].updatedAt, 10_000, "Gửi lại không kéo dài khóa vô hạn");
  assert.equal(completedQuestionRepeat([completed({ id: "newer", updatedAt: 11_000 }), ...history], attempt, 11_001)?.id, "newer");
});

test("Lịch sử chờ/đang đọc/bỏ qua và phòng không xác định không bị coi là đã hoàn tất cùng phòng", () => {
  for (const status of ["ready", "reading", "waiting_condition", "skipped"])
    assert.equal(completedQuestionRepeat([completed({ status })], attempt, 10_001), undefined);
  assert.equal(completedQuestionRepeat([completed({ roomId: undefined })], attempt, 10_001), undefined);
  assert.equal(completedQuestionRepeat([completed({ roomId: undefined })], { ...attempt, roomId: undefined }, 10_001)?.id, "completed-1");
  assert.equal(completedQuestionRepeat([completed()], { ...attempt, question: "   " }, 10_001), undefined);
});

test("Chỉ hash tạm hết hạn được dọn; msgId thật giữ nguyên và clock lùi không gây khóa vô hạn", () => {
  const hash = missingIdChatReplay(event(), {}, 1000)!.key;
  const seen = { [hash]: 1000, "room-1:chat:real-msg-id": 0 };
  assert.deepEqual(expiredChatReplayKeys(seen, 1000 + CHAT_REPLAY_WINDOW_MS - 1), []);
  assert.deepEqual(expiredChatReplayKeys(seen, 1000 + CHAT_REPLAY_WINDOW_MS), [hash]);
  assert.equal(missingIdChatReplay(event(), seen, 999)?.duplicate, false);
  assert.equal(completedQuestionRepeat([completed()], attempt, 9999), undefined);
  assert.equal(missingIdChatReplay(event(), seen, 1001, undefined, 0)?.duplicate, false);
});
