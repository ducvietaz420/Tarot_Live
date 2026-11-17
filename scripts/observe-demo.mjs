import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

// Passive observation only: no actions, audio claims, credentials or external APIs.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(root, "qa/demo-ai-av-check.json");
const prefix = "demo-ai-av-check-";
const excludedReadingId = process.argv.find((arg) => arg.startsWith("--after="))?.slice("--after=".length);
const clientId = "qa-observer-" + randomUUID();
const words = (value) => value.trim().split(/\s+/u).filter(Boolean).length;
const spokenPhases = ["card1", "card2", "card3", "summary"];
const expectedPhases = ["locking", "shuffling", "dealing", ...spokenPhases, "complete"];
const result = {
  checkedAt: new Date().toISOString(),
  ok: false,
  mode: "demo",
  passiveObserver: true,
  readingId: null,
  cards: null,
  source: null,
  content: null,
  config: null,
  phases: [],
  speech: Object.fromEntries(spokenPhases.map((phase) => [phase, {
    audioActiveObserved: false,
    boundaryUpdates: 0,
    estimatedUpdates: 0,
    maximumCharIndex: 0,
    status: [],
  }])),
  completionStatus: null,
  errors: [],
  limitations: "Browser speech progress is observed; physical speaker/OBS capture is not measured. Music and shuffle configuration/phase coverage are observed, not an audio recording.",
};

let finished = false;
let lastPhase;
let fixedCards;
let readingCreatedAt;
let itemId;
let lastStatus;
const seenProgress = new Set();
const startedAt = Date.now();
const ws = new WebSocket(`ws://127.0.0.1:3210/ws?mode=demo&clientId=${clientId}`, {
  origin: "http://127.0.0.1:3210",
});
const deadline = setTimeout(() => void finish(new Error("Observer timed out before the requested demo completed.")), 360_000);

async function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(deadline);
  ws.close();
  result.elapsedMs = Date.now() - startedAt;
  result.readingElapsedMs = readingCreatedAt ? Date.now() - readingCreatedAt : null;
  result.elapsedIncludesWaitingForReading = true;
  if (error) result.errors.push(String(error.message).slice(0, 300));
  else {
    try {
      assert.equal(result.source, "ai", "New demo did not contain AI content.");
      assert.deepEqual(result.phases.map((entry) => entry.phase).filter((phase) => !["followup", "answer"].includes(phase)), expectedPhases, "Not all expected main-reading phases were observed.");
      assert.equal(result.completionStatus, "completed", "The demo queue item did not complete.");
      for (const phase of spokenPhases) {
        assert.equal(result.speech[phase].audioActiveObserved, true, `No active audio observed in ${phase}.`);
        assert.ok(result.speech[phase].boundaryUpdates > 0, `No real speech boundaries observed in ${phase}.`);
      }
      assert.equal(result.content?.cardsUnchanged, true);
      assert.equal(result.content?.speechMatchesText, true);
      assert.equal(result.config.music, true);
      assert.equal(result.config.sfx, true);
      result.ok = true;
    } catch (failure) { result.errors.push(failure.message); }
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(result, null, 2) + "\n");
  console.log("OBSERVATION_COMPLETE " + JSON.stringify({ ok: result.ok, readingId: result.readingId, elapsedMs: result.elapsedMs, completionStatus: result.completionStatus, errors: result.errors, speech: result.speech }));
  if (!result.ok) process.exitCode = 1;
}

ws.on("open", () => console.log("OBSERVER_READY"));
ws.on("error", (error) => void finish(error));
ws.on("close", () => {
  if (!finished) void finish(new Error("Observer connection closed before demo completion."));
});
ws.on("message", (data) => {
  if (finished) return;
  try {
    const snapshot = JSON.parse(data.toString());
    const reading = snapshot.session?.active;
    if (!result.readingId) {
      if (!reading || reading.id === excludedReadingId || ![prefix, "demo-user-"].some((value) => reading.user?.id?.startsWith(value))) return;
      result.readingId = reading.id;
      readingCreatedAt = reading.createdAt;
      fixedCards = structuredClone(reading.cards);
      result.cards = fixedCards;
      itemId = reading.itemId;
      result.config = {
        aiEnabled: reading.config.aiEnabled,
        model: reading.config.aiModel,
        provider: reading.config.ttsProvider,
        voice: reading.config.voice,
        speechRate: reading.config.speechRate,
        speechVolume: reading.config.speechVolume,
        music: snapshot.config.music,
        musicVolume: snapshot.config.musicVolume,
        sfx: snapshot.config.sfx,
        sfxVolume: snapshot.config.sfxVolume,
      };
      console.log("READING_DETECTED " + reading.id);
    }
    if (!reading || reading.id !== result.readingId) {
      const item = snapshot.session.queue.find((entry) => entry.id === itemId);
      result.completionStatus = item?.status || null;
      if (result.completionStatus === "completed") void finish();
      else if (result.completionStatus === "skipped") void finish(new Error("The requested demo was skipped."));
      return;
    }
    assert.deepEqual(reading.cards, fixedCards, "Selected cards changed during demo.");
    if (reading.phase !== lastPhase) {
      lastPhase = reading.phase;
      result.phases.push({ phase: lastPhase, at: new Date(snapshot.serverTime).toISOString(), elapsedMs: snapshot.serverTime - reading.createdAt });
      console.log("PHASE " + JSON.stringify({ phase: lastPhase, source: reading.content.source, elapsedMs: snapshot.serverTime - reading.createdAt }));
    }
    result.source = reading.content.source;
    if (reading.content.source === "ai" && !result.content) {
      const cards = reading.content.cards.map((card, index) => {
        const metadata = { cardId: card.cardId, position: card.position, reversed: card.reversed };
        assert.deepEqual(metadata, fixedCards[index]);
        const count = words(card.text);
        assert.ok(count >= 30 && count <= reading.config.displayWords);
        assert.match(card.text, /[.!?][”"')\]]*$/u);
        assert.equal(card.speech, card.text);
        return { ...metadata, words: count };
      });
      const summaryWords = words(reading.content.summary);
      assert.ok(summaryWords >= 20 && summaryWords <= reading.config.summaryWords);
      assert.match(reading.content.summary, /[.!?][”"')\]]*$/u);
      result.content = { cardsUnchanged: true, speechMatchesText: true, cards, summaryWords };
      console.log("AI_CONTENT_CONFIRMED " + JSON.stringify({ words: cards.map((card) => card.words), summaryWords }));
    }
    if (reading.content.error) {
      // Content errors are fixed application messages, never provider bodies or keys.
      const message = String(reading.content.error).slice(0, 300);
      if (!result.errors.includes(message)) result.errors.push(message);
    }
    const speech = result.speech[reading.phase];
    if (speech) {
      speech.audioActiveObserved ||= !!snapshot.audioActive;
      if (snapshot.audioStatus && snapshot.audioStatus !== lastStatus) {
        lastStatus = snapshot.audioStatus;
        speech.status.push(String(snapshot.audioStatus).slice(0, 220));
      }
      const segment = snapshot.audioSegment;
      if (segment?.readingId === reading.id && segment.phase === reading.phase) {
        const progressKey = `${reading.phase}:${segment.generation}:${segment.timing}:${segment.charIndex}`;
        if (!seenProgress.has(progressKey)) {
          seenProgress.add(progressKey);
          if (segment.timing === "boundary") speech.boundaryUpdates++;
          if (segment.timing === "estimated") speech.estimatedUpdates++;
        }
        speech.maximumCharIndex = Math.max(speech.maximumCharIndex, segment.charIndex || 0);
      }
    }
  } catch (error) { void finish(error); }
});
