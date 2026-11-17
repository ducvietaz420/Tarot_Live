import type { Reading } from "./types";

export type FollowUpViewStatus =
  | "history"
  | "closed"
  | "paused"
  | "waiting"
  | "generating"
  | "answering"
  | "limit"
  | "recovering";

/** Derive the visible state from actual work, including sessions saved by v1. */
export function deriveFollowUpState(reading: Pick<Reading, "phase" | "paused" | "followUp">, now: number) {
  const session = reading.followUp;
  const history = !session || !["followup", "answer"].includes(reading.phase);
  const pending = session?.questions.some((question) =>
    question.status === "queued" || question.status === "generating",
  ) || false;
  const current = session?.questions.find((question) => question.id === session.currentQuestionId);
  const answering = reading.phase === "answer" && !!(
    current?.status === "answered" && current.answer?.trim()
  );
  const idleWindow = !history && reading.phase === "followup" && !pending;
  const deadline = session?.deadline || 0;
  const remainingSeconds = Math.max(0, Math.ceil((deadline - now) / 1000));
  // A snapshot can open the new window just before the UI clock ticks again.
  // Current windows are 30 seconds; don't briefly render 31 on that stale tick.
  const seconds = idleWindow && session?.awaitingQuestion === true
    ? Math.min(30, remainingSeconds)
    : remainingSeconds;
  const expired = idleWindow && deadline > 0 && now >= deadline;
  const closed = history || !!session?.closedReason || expired;
  // Older persisted sessions have no awaitingQuestion flag. A live input
  // deadline with no queued/generating question is the authoritative UI clue.
  const waiting = !closed && idleWindow && deadline > now && (session?.questions.length || 0) < 3;
  const generating = !closed && !history && reading.phase === "followup" && pending;
  const status: FollowUpViewStatus = history ? "history"
    : closed ? "closed"
    : reading.paused ? "paused"
    : generating ? "generating"
    : answering ? "answering"
    : waiting ? "waiting"
    : (session?.questions.length || 0) >= 3 ? "limit"
    : "recovering";
  return {
    status,
    history,
    closed,
    waiting,
    generating,
    answering,
    seconds,
    canAsk: waiting && !reading.paused,
    canDraft: !closed,
    canRetry: !closed && !reading.paused && idleWindow && deadline > now,
  };
}
