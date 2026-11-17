import test from "node:test";
import assert from "node:assert/strict";
import { blankSession, DEFAULT_CONFIG } from "../server/engine.ts";
import { currentSpeech, speechPlaybackKey } from "../src/audio.ts";
import type { Snapshot } from "../shared/types.ts";

function fixture(): Snapshot {
  const config = structuredClone(DEFAULT_CONFIG);
  return {
    mode: "demo", config, audioOwner: "overlay", serverTime: 1000,
    capabilities: { ai: true, tts: true },
    connection: { status: "connected", url: "", attempts: 0 },
    session: {
      ...blankSession(),
      active: {
        id: "reading-one", itemId: "queue-one", user: { id: "user-one", name: "An" },
        topic: "Tình duyên", question: "Tôi nên chú ý điều gì?", cards: [],
        content: {
          opening: "Mở bài", source: "ai", summary: "Tổng kết của ba lá.",
          cards: [0, 1, 2].map((index) => ({
            cardId: `card-${index}`, position: index, reversed: false,
            text: `Nội dung lá ${index + 1}.`, speech: `Giọng đọc lá ${index + 1}.`,
          })),
        },
        phase: "answer", paused: false, phaseStartedAt: 1000, phaseDuration: 20000,
        createdAt: 0, generation: 1, config,
        followUp: {
          openedAt: 1000, deadline: 121000, currentQuestionId: "question-one",
          // Array order differs from the selected question deliberately.
          questions: [
            { id: "question-three", question: "Câu hỏi ba?", answer: "Lời đáp thứ ba.", status: "answered", askedAt: 1000 },
            { id: "question-one", question: "Câu hỏi một?", answer: "Lời đáp thứ nhất dài hơn câu tiếp theo.", status: "answered", askedAt: 1000 },
            { id: "question-two", question: "Câu hỏi hai?", answer: "Lời đáp thứ hai.", status: "answered", askedAt: 1000 },
          ],
        },
      },
    },
  };
}

test("Ba câu trả lời có cursor riêng để câu sau luôn được đọc từ đầu", () => {
  const state = fixture();
  const reading = state.session.active!;
  const keys: string[] = [];
  const answers: string[] = [];
  const savedCursor = { key: speechPlaybackKey(state), charIndex: 25 };
  for (const id of ["question-one", "question-two", "question-three"]) {
    reading.followUp!.currentQuestionId = id;
    keys.push(speechPlaybackKey(state));
    answers.push(currentSpeech(state));
  }
  assert.equal(new Set(keys).size, 3);
  assert.deepEqual(answers, [
    "Lời đáp thứ nhất dài hơn câu tiếp theo.", "Lời đáp thứ hai.", "Lời đáp thứ ba.",
  ]);
  assert.deepEqual(keys.map((key) => savedCursor.key === key ? savedCursor.charIndex : 0), [25, 0, 0]);
});

test("Pause và resume cùng câu giữ cursor dù generation tăng", () => {
  const state = fixture();
  const reading = state.session.active!;
  const key = speechPlaybackKey(state);
  reading.paused = true;
  reading.generation!++;
  assert.equal(speechPlaybackKey(state), key);
  reading.paused = false;
  reading.generation!++;
  assert.equal(speechPlaybackKey(state), key);
  assert.equal(currentSpeech(state), "Lời đáp thứ nhất dài hơn câu tiếp theo.");
});

test("Các pha bài chính giữ lời đọc riêng, hỏi đáp chờ hoặc đáp lỗi không phát lại nội dung cũ", () => {
  const state = fixture();
  const reading = state.session.active!;
  const keys = new Set<string>();
  for (const [phase, speech] of [
    ["card1", "Giọng đọc lá 1."], ["card2", "Giọng đọc lá 2."],
    ["card3", "Giọng đọc lá 3."], ["summary", "Tổng kết của ba lá."],
  ] as const) {
    reading.phase = phase;
    const key = speechPlaybackKey(state);
    keys.add(key);
    reading.followUp!.currentQuestionId = "question-two";
    assert.equal(speechPlaybackKey(state), key);
    assert.equal(currentSpeech(state), speech);
  }
  assert.equal(keys.size, 4);
  reading.phase = "followup";
  assert.equal(currentSpeech(state), "");
  reading.phase = "answer";
  reading.followUp!.questions.find((item) => item.id === "question-two")!.status = "failed";
  assert.equal(currentSpeech(state), "");
  reading.followUp!.currentQuestionId = "stale-question";
  assert.equal(currentSpeech(state), "");
  state.session.active = null;
  assert.equal(currentSpeech(state), "");
  assert.equal(speechPlaybackKey(state), "");
});
