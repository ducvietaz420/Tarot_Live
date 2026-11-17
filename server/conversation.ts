import type { Topic } from "../shared/types.ts";

export interface ConversationInput {
  topic?: Topic;
  question: string;
  join: boolean;
}

function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/gu, "d").replace(/Đ/gu, "D").toLowerCase();
}

const topicNames: [Topic, string][] = [
  ["Tình duyên", "tinh duyen|tinh yeu|chuyen tinh cam|tinh cam"],
  ["Công việc", "cong viec|su nghiep"],
  ["Tiền bạc", "tien bac|tai chinh"],
  ["Học hành", "hoc hanh|hoc tap|thi cu"],
  ["Gia đình", "gia dinh"],
];

// These words alone express a choice or request for a reading, not its question.
function requestOnly(text: string): boolean {
  return !fold(text)
    .replace(/\b(?:chu de|lam on|co the|duoc khong|xem boi|xem bai|rut bai)\b/gu, " ")
    .replace(/\b(?:toi|minh|em|con|anh|chi|ban|chau|muon|can|chon|xem|boi|rut|bai|ve|la|cho|giup|ho|xin|duoc|voi|nhe|nha|a|da|tarot)\b/gu, " ")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function meaningfulQuestion(text: string, maxLength: number): string {
  const value = text.replace(/^[\s|:;,–—-]+|[\s|:;,–—-]+$/gu, "").trim();
  if (value.length < 8 || value.length > maxLength || !/\p{L}/u.test(value) || requestOnly(value)) return "";
  let topicChoice = fold(value);
  for (const [, names] of topicNames)
    topicChoice = topicChoice.replace(new RegExp(`\\b(?:${names})\\b`, "gu"), " ");
  if (requestOnly(topicChoice.replace(/\b(?:va|hay|hoac)\b/gu, " "))) return "";
  const smallTalk = fold(value).replace(/[^\p{L}\p{N}\s]/gu, " ").trim().replace(/\s+/gu, " ");
  if (/^(?:(?:cam on|xin chao|moi nguoi|rat nhieu|nhieu lam|nhieu|chao|hello|hi|ok|okay|vang|da|roi|duoc|tot|hay qua|tuyet voi|yeu ban|hihi|haha|ha|hi|a|nhe|nha|chi|anh|ban|em|toi|minh)\s*)+$/u.test(smallTalk)) return "";
  if (value.match(/\p{L}+/gu)!.length < 3) return "";
  return value;
}

/** Parse a viewer's own words without requiring command syntax or an AI call. */
export function parseConversation(
  comment: string,
  maxLength: number,
  selectedTopic?: Topic,
): ConversationInput | undefined {
  const text = comment.normalize("NFC").trim().replace(/\s+/gu, " ");
  if (!text || text.startsWith("!") || text.length > maxLength + 80 || /(?:https?:\/\/|www\.)/iu.test(text) || /(.)\1{8,}/u.test(text)) return;
  const join = /(?<![\p{L}\p{N}_])tarot(?![\p{L}\p{N}_])/iu.test(text);
  const raw = text.replace(/(?<![\p{L}\p{N}_])tarot(?![\p{L}\p{N}_])/giu, " ").trim().replace(/\s+/gu, " ");
  const normalized = fold(raw);
  const matches = topicNames.flatMap(([topic, names]) => {
    const match = new RegExp(`(?<![\\p{L}\\p{N}])(?:${names})(?![\\p{L}\\p{N}])`, "u").exec(normalized);
    return match ? [{ topic, index: match.index, end: match.index + match[0].length }] : [];
  }).sort((a, b) => a.index - b.index);
  const found = matches[0];
  const topic = found?.topic ?? selectedTopic;
  if (!join && !topic) return;
  let candidate = raw;
  if (found && requestOnly(raw.slice(0, found.index))) candidate = raw.slice(found.end);
  const question = meaningfulQuestion(candidate, maxLength);
  if (!join && !found && !question) return;
  return { ...(topic ? { topic } : {}), question, join };
}
