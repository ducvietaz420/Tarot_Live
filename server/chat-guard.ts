import { createHash } from "node:crypto";
import type { NormalizedEvent } from "../shared/types.ts";

export const CHAT_REPLAY_WINDOW_MS = 5_000;
export const COMPLETED_QUESTION_REPEAT_WINDOW_MS = 120_000;
const MISSING_ID_PREFIX = "chat-missing-id:";

/** Keep accents and punctuation meaningful; ignore casing and transport whitespace. */
export function normalizeChatText(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("vi");
}

function withinWindow(at: number | undefined, now: number, windowMs: number) {
  if (!Number.isFinite(at) || !Number.isFinite(now) || !Number.isFinite(windowMs) || windowMs <= 0)
    return false;
  const age = now - at!;
  return age >= 0 && age < windowMs;
}

/**
 * A short-lived best-effort replay key, separate from authoritative msgId keys.
 * Caller stores seen[result.key] = now only after accepting a nonduplicate frame.
 */
export function missingIdChatReplay(
  event: Pick<NormalizedEvent, "type" | "id" | "roomId" | "user" | "comment">,
  seen: Readonly<Record<string, number>>,
  now: number,
  currentRoomId?: string,
  windowMs = CHAT_REPLAY_WINDOW_MS,
): { key: string; duplicate: boolean } | undefined {
  if (event.type !== "chat" || event.id || !event.user?.id || !event.comment) return;
  const content = normalizeChatText(event.comment);
  if (!content) return;
  const fingerprint = JSON.stringify([
    event.roomId || currentRoomId || "session",
    event.user.id,
    content,
  ]);
  const key = MISSING_ID_PREFIX + createHash("sha256").update(fingerprint).digest("hex");
  return { key, duplicate: withinWindow(seen[key], now, windowMs) };
}

/** Only expiring fallback hashes are returned; permanent msgId keys stay intact. */
export function expiredChatReplayKeys(
  seen: Readonly<Record<string, number>>,
  now: number,
  windowMs = CHAT_REPLAY_WINDOW_MS,
): string[] {
  return Object.keys(seen).filter(
    (key) => key.startsWith(MISSING_ID_PREFIX) && !withinWindow(seen[key], now, windowMs),
  );
}

export interface QuestionHistoryEntry {
  user: { id: string };
  topic: string;
  question: string;
  status: string;
  updatedAt: number;
  roomId?: string;
}

export interface QuestionAttempt {
  userId: string;
  topic: string;
  question: string;
  roomId?: string;
}

/** A new event ID does not bypass the short same-question policy after completion. */
export function completedQuestionRepeat<T extends QuestionHistoryEntry>(
  history: readonly T[],
  attempt: QuestionAttempt,
  now: number,
  windowMs = COMPLETED_QUESTION_REPEAT_WINDOW_MS,
): T | undefined {
  const question = normalizeChatText(attempt.question);
  if (!attempt.userId || !question) return;
  const topic = normalizeChatText(attempt.topic);
  const room = attempt.roomId || "session";
  let latest: T | undefined;
  for (const entry of history) {
    if (
      entry.status !== "completed" ||
      entry.user.id !== attempt.userId ||
      (entry.roomId || "session") !== room ||
      !withinWindow(entry.updatedAt, now, windowMs) ||
      normalizeChatText(entry.topic) !== topic ||
      normalizeChatText(entry.question) !== question
    ) continue;
    if (!latest || entry.updatedAt > latest.updatedAt) latest = entry;
  }
  return latest;
}
