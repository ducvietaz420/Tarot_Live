import test from "node:test";
import assert from "node:assert/strict";
import { deriveFollowUpState } from "../shared/followup.ts";
import type { FollowUpQuestion, Reading } from "../shared/types.ts";

type ViewReading = Pick<Reading, "phase" | "paused" | "followUp">;
const now = 1_000_000;
function reading(patch: Partial<ViewReading> = {}): ViewReading {
  return {
    phase: "followup",
    paused: false,
    followUp: { openedAt: now, deadline: now + 30_000, questions: [] },
    ...patch,
  };
}
function question(status: FollowUpQuestion["status"], id = "question-1"): FollowUpQuestion {
  return { id, question: "Tôi nên chú ý điều gì tiếp theo?", status, askedAt: now,
    ...(status === "answered" ? { answer: "Hãy bắt đầu bằng một cuộc trò chuyện cởi mở." } : {}) };
}

test("Phiên cũ chưa có awaitingQuestion vẫn mở khung hỏi khi có deadline và chưa có tác vụ", () => {
  const value = reading();
  assert.equal(value.followUp?.awaitingQuestion, undefined);
  const view = deriveFollowUpState(value, now + 5000);
  assert.equal(view.status, "waiting");
  assert.equal(view.seconds, 25);
  assert.equal(view.canAsk, true);
  assert.equal(view.canDraft, true);
  assert.equal(view.generating, false);
});

test("Cờ awaitingQuestion cũ không khiến màn hình báo đang trả lời khi chưa có câu hỏi", () => {
  const value = reading();
  value.followUp!.awaitingQuestion = false;
  assert.equal(deriveFollowUpState(value, now).status, "waiting");
});

test("Cửa sổ mới không nháy 31 giây khi đồng hồ giao diện chậm hơn snapshot", () => {
  const value = reading();
  value.followUp!.awaitingQuestion = true;
  value.followUp!.deadline = now + 30_400;
  const view = deriveFollowUpState(value, now);
  assert.equal(view.status, "waiting");
  assert.equal(view.seconds, 30);
  assert.equal(view.canAsk, true);
});

test("Phiên cũ chưa có cờ chờ vẫn hiển thị đúng deadline cũ thay vì giả lập 30 giây", () => {
  const value = reading();
  value.followUp!.deadline = now + 120_000;
  assert.equal(deriveFollowUpState(value, now).seconds, 120);
});

for (const status of ["queued", "generating"] as const) {
  test(`Câu ${status} ngăn gửi câu mới nhưng vẫn cho soạn trước, kể cả cờ chờ cũ bị sai`, () => {
    const value = reading();
    value.followUp!.questions = [question(status)];
    value.followUp!.awaitingQuestion = true;
    const view = deriveFollowUpState(value, now);
    assert.equal(view.status, "generating");
    assert.equal(view.waiting, false);
    assert.equal(view.canAsk, false);
    assert.equal(view.canDraft, true);
    assert.equal(view.canRetry, false);
  });
}

test("Deadline bằng 0 lúc AI đang tạo lời đáp không bị hiểu thành hết giờ", () => {
  const value = reading();
  value.followUp!.deadline = 0;
  value.followUp!.questions = [question("generating")];
  const view = deriveFollowUpState(value, now);
  assert.equal(view.closed, false);
  assert.equal(view.status, "generating");
  assert.equal(view.canDraft, true);
  assert.equal(view.canAsk, false);
});

test("Đang đọc câu trả lời cho soạn nháp, chỉ mở thời gian gửi sau khi trở về pha hỏi", () => {
  const item = question("answered");
  const value = reading({ phase: "answer", followUp: {
    openedAt: now, deadline: 0, questions: [item], currentQuestionId: item.id,
  } });
  const answering = deriveFollowUpState(value, now + 90_000);
  assert.equal(answering.status, "answering");
  assert.equal(answering.canDraft, true);
  assert.equal(answering.canAsk, false);
  value.phase = "followup";
  value.followUp!.currentQuestionId = undefined;
  value.followUp!.deadline = now + 120_000;
  const waiting = deriveFollowUpState(value, now + 90_000);
  assert.equal(waiting.status, "waiting");
  assert.equal(waiting.seconds, 30);
  assert.equal(waiting.canAsk, true);
});

test("Tạm dừng vẫn cho nhập nháp nhưng chặn gửi và thử lại", () => {
  const value = reading({ paused: true });
  const view = deriveFollowUpState(value, now + 10_000);
  assert.equal(view.status, "paused");
  assert.equal(view.waiting, true);
  assert.equal(view.seconds, 20);
  assert.equal(view.canDraft, true);
  assert.equal(view.canAsk, false);
  assert.equal(view.canRetry, false);
});

test("Đúng hạn 30 giây thì khóa gửi và nhập nháp, không còn giả vờ đang giải đáp", () => {
  const view = deriveFollowUpState(reading(), now + 30_000);
  assert.equal(view.status, "closed");
  assert.equal(view.seconds, 0);
  assert.equal(view.canAsk, false);
  assert.equal(view.canDraft, false);
  assert.equal(view.canRetry, false);
});

test("Không có deadline lẫn tác vụ là trạng thái đồng bộ, không phải đang giải đáp", () => {
  const value = reading();
  value.followUp!.deadline = 0;
  const view = deriveFollowUpState(value, now);
  assert.equal(view.status, "recovering");
  assert.equal(view.generating, false);
  assert.equal(view.canDraft, true);
  assert.equal(view.canAsk, false);
});

test("Đủ ba câu chặn câu mới, vẫn có thể thử lại câu bị lỗi trong hạn", () => {
  const value = reading();
  value.followUp!.questions = [question("answered", "1"), question("answered", "2"), question("failed", "3")];
  const view = deriveFollowUpState(value, now);
  assert.equal(view.status, "limit");
  assert.equal(view.canAsk, false);
  assert.equal(view.canRetry, true);
});

test("Phiên đã đóng hoặc lịch sử không cho soạn hay gửi dù deadline vẫn còn", () => {
  const closed = reading();
  closed.followUp!.closedReason = "admin";
  for (const value of [closed, reading({ phase: "complete" })]) {
    const view = deriveFollowUpState(value, now);
    assert.equal(view.closed, true);
    assert.equal(view.waiting, false);
    assert.equal(view.canDraft, false);
    assert.equal(view.canAsk, false);
  }
});
