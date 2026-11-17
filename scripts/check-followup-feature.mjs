import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";

const marker = "TAROT_FOLLOWUP_FEATURE_REQUEST";
const syntheticQuestion = "Trong tuần tới tôi nên tập trung điều gì trong công việc?";
const syntheticIdentity = { userId: "codex-followup-test", nickname: "Kiểm thử hỏi đáp" };
const questions = [
  "Tôi nên bắt đầu từ việc gì trong tuần này?",
  "Tôi cần tránh điều gì để không lặp lại vấn đề cũ?",
  "Nếu chưa có tiến triển thì tôi nên điều chỉnh thế nào?",
];
const endpoint = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const model = "gemini-3.5-flash-lite";
const words = (text) => text.trim().split(/\s+/u).filter(Boolean).length;
const wait = (ms) => new Promise((done) => setTimeout(done, ms));

// Preloaded only in our disposable backend. Each outgoing request is checked
// before fetch; response context is retained in memory, never logged here.
if (process.env.TAROT_FOLLOWUP_FEATURE_PROBE === "true") {
  const originalFetch = globalThis.fetch;
  const { getCard } = await import("../shared/cards.ts");
  const { validateAI, capText } = await import("../server/providers.ts");
  let originalCards;
  let originalContent;
  const previous = [];
  globalThis.fetch = async (...args) => {
    const request = args[0];
    const url = new URL(typeof request === "string" || request instanceof URL ? request : request.url);
    if (url.protocol === "http:" && url.hostname === "127.0.0.1") return originalFetch(...args);
    assert.equal(url.href, endpoint, "Unexpected external destination.");
    const body = JSON.parse(args[1]?.body || "{}");
    assert.equal(body.model, model);
    assert.equal(body.messages.length, 2);
    assert.equal(body.messages[0].role, "system");
    assert.equal(body.messages[1].role, "user");
    assert.ok(!args[1].body.includes(process.env.AI_API_KEY), "Credentials are forbidden in prompt content.");
    const payload = JSON.parse(body.messages[1].content);
    assert.equal(payload.topic, "Công việc");
    const initial = Object.hasOwn(payload, "question") && !Object.hasOwn(payload, "originalQuestion");
    if (initial) {
      assert.equal(originalCards, undefined, "Only one initial synthetic reading is permitted.");
      assert.deepEqual(Object.keys(payload).sort(), ["cards", "question", "topic"]);
      assert.equal(payload.question, syntheticQuestion);
      assert.equal(payload.cards.length, 3);
      payload.cards.forEach((card, index) => {
        assert.deepEqual(Object.keys(card).sort(), ["cardId", "data", "position", "reversed"]);
        assert.equal(card.position, index);
        assert.equal(typeof card.reversed, "boolean");
        assert.deepEqual(card.data, getCard(card.cardId), "Only bundled public tarot data is permitted.");
      });
      originalCards = payload.cards.map(({ cardId, position, reversed }) => ({ cardId, position, reversed }));
    } else {
      assert.ok(originalContent, "No completed synthetic reading exists.");
      assert.ok(previous.length < 3, "Only three follow-up calls are permitted.");
      assert.deepEqual(Object.keys(payload).sort(), ["cards", "originalQuestion", "originalSummary", "previous", "question", "topic"]);
      assert.equal(payload.originalQuestion, syntheticQuestion);
      assert.equal(payload.question, questions[previous.length]);
      assert.deepEqual(payload.cards, originalContent.cards.map(({ cardId, position, reversed, text }) => ({ cardId, position, reversed, text })));
      assert.equal(payload.originalSummary, originalContent.summary);
      assert.deepEqual(payload.previous, previous, "Follow-up context must match only this synthetic reading's answered history.");
    }
    console.log(`${marker}:${initial ? "reading" : `answer${previous.length + 1}`}`);
    const response = await originalFetch(...args);
    if (response.ok) {
      const envelope = await response.clone().json();
      const result = JSON.parse(envelope.choices?.[0]?.message?.content || "");
      if (initial) {
        originalContent = validateAI(result, { cards: originalCards, config: { displayWords: 65, summaryWords: 50 } });
      } else {
        assert.equal(typeof result.answer, "string");
        previous.push({ question: payload.question, answer: capText(result.answer, 70, 20) });
      }
    }
    return response;
  };
} else {
  await run();
}

async function run() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const temporaryRoot = join(root, "tmp");
  const output = join(root, "qa", "followup-feature.json");
  const origin = "http://127.0.0.1:54323";
  const hold = process.argv.includes("--hold-for-ui");
  const historyHold = process.argv.includes("--history-for-ui");
  console.log(JSON.stringify({ preflight: {
    destination: endpoint, model, syntheticUser: syntheticIdentity, syntheticQuestion,
    syntheticFollowUps: questions,
    content: "One fixed synthetic DEMO question, public bundled tarot cards, the generated synthetic reading and its three synthetic follow-up answers only. No live database or real viewer data is read.",
    outgoingGuard: "Exact endpoint/model/question/topic/keys/public card records for the initial call; exact same generated cards/text/summary and previous synthetic answers for each of three allowed follow-up calls. No other external fetch permitted.",
    isolatedPort: 54323, holdForUi: hold, historyHoldMs: historyHold ? 12000 : 0,
  } }, null, 2));
  if (process.argv.includes("--preflight")) return;
  let secret = "";
  let fixture;
  let child;
  let childOutput = "";
  let requestCount = 0;
  const result = { checkedAt: new Date().toISOString(), ok: false, provider: "Gemini", model, isolatedPort: 54323, syntheticDataOnly: true, main: null, followUps: [] };
  const sanitize = (message) => (secret ? String(message).replaceAll(secret, "[redacted]") : String(message)).slice(0, 1200);
  const state = async () => {
    const response = await fetch(`${origin}/api/state?mode=demo`, { signal: AbortSignal.timeout(2000) });
    assert.equal(response.status, 200);
    return response.json();
  };
  const action = async (value, expectedStatus = 200) => {
    const response = await fetch(`${origin}/api/action?mode=demo`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify(value), signal: AbortSignal.timeout(3000),
    });
    const snapshot = await response.json();
    assert.equal(response.status, expectedStatus, `Action ${value.type} failed: ${snapshot.error || response.status}`);
    return snapshot;
  };
  const chat = (comment, user = syntheticIdentity, msgId) => action({
    type: "demo", scenario: "synthetic-fixture", envelope: {
      event: "chat", data: { ...user, uniqueId: user.userId, ...(msgId ? { msgId } : {}), comment },
    },
  });
  try {
    let occupied = false;
    try { await fetch(`${origin}/api/state?mode=demo`, { signal: AbortSignal.timeout(500) }); occupied = true; } catch {}
    assert.equal(occupied, false, "Port 54323 is occupied; refusing to use or stop another server.");
    const env = parse(await readFile(join(root, "backend", ".env"), "utf8"));
    secret = env.AI_API_KEY || "";
    assert.ok(secret, "Backend Gemini key is missing.");
    assert.equal(env.AI_BASE_URL?.replace(/\/$/u, "") + "/chat/completions", endpoint);
    await mkdir(temporaryRoot, { recursive: true });
    fixture = await mkdtemp(join(temporaryRoot, "followup-feature-"));
    child = spawn(process.execPath, ["--import", "tsx", "--import", import.meta.url, join(root, "server", "index.ts"), "--production"], {
      cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PORT: "54323", DATA_PATH: join(fixture, "state.sqlite"), TIKFINITY_AUTOCONNECT: "false", TIKFINITY_URL: "ws://127.0.0.1:1/", AI_API_KEY: secret, AI_BASE_URL: env.AI_BASE_URL, AI_JSON_MODE: "true", AI_MODEL: model, TTS_URL: "", TTS_API_KEY: "", TAROT_FOLLOWUP_FEATURE_PROBE: "true" },
    });
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      requestCount += text.split(marker).length - 1;
      childOutput = (childOutput + text).slice(-4000);
    });
    child.stderr.on("data", (chunk) => { childOutput = (childOutput + chunk.toString()).slice(-4000); });
    child.on("error", (error) => { childOutput += error.message; });
    const bootDeadline = Date.now() + 8000;
    let initial;
    while (Date.now() < bootDeadline) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Isolated backend exited: ${sanitize(childOutput)}`);
      try { initial = await state(); break; } catch {}
      await wait(100);
    }
    assert.ok(initial, `Isolated backend did not become ready: ${sanitize(childOutput)}`);
    assert.equal(initial.session.queue.length, 0);
    assert.equal(initial.capabilities.ai, true);
    console.log(`PORT_READY ${origin}`);
    await action({ type: "config", config: {
      aiEnabled: true, aiModel: model, aiTimeoutSec: 30, followUpEnabled: true, followUpWindowSec: 120,
      joinMode: "free", cooldownSec: 0, autoRun: false, displayWords: 65, summaryWords: 50,
      ttsProvider: hold ? "browser" : "off", voice: "Microsoft HoaiMy Online (Natural) - Vietnamese (Vietnam)", speechRate: 1, speechVolume: 0.85,
      music: hold, musicVolume: 0.2, sfx: hold, sfxVolume: 0.7,
      durations: { locking: 2, shuffling: 3, dealing: 2, card: 60, summary: 60, complete: 6 },
    } });
    await chat(`!tarot công việc | ${syntheticQuestion}`, syntheticIdentity, "synthetic-main");
    const startedAt = Date.now();
    const started = await action({ type: "start" });
    const readingId = started.session.active.id;
    const originalCards = started.session.active.cards;
    let ready;
    while (Date.now() - startedAt < 35000) {
      const reading = (await state()).session.active;
      assert.equal(reading?.id, readingId);
      assert.deepEqual(reading.cards, originalCards);
      if (reading.content.source === "ai") { ready = reading; break; }
      if (reading.content.error) throw new Error(reading.content.error);
      await wait(150);
    }
    assert.ok(ready, "Initial AI reading timed out.");
    const originalContent = structuredClone(ready.content);
    result.main = { elapsedMs: Date.now() - startedAt, source: ready.content.source, cards: ready.content.cards.map((card) => ({ ...card, words: words(card.text) })), summary: ready.content.summary, summaryWords: words(ready.content.summary) };
    for (const card of result.main.cards) {
      assert.ok(card.words >= 30 && card.words <= 65);
      assert.match(card.text, /[.!?][”"')\]]*$/u);
      assert.ok(!/[.…]{2,}[”"')\]]*$/u.test(card.text));
    }
    assert.ok(result.main.summaryWords >= 20 && result.main.summaryWords <= 50);
    assert.match(result.main.summary, /[.!?][”"')\]]*$/u);
    assert.ok(!/[.…]{2,}[”"')\]]*$/u.test(result.main.summary));
    let snapshot = await state();
    for (let index = 0; index < 10 && snapshot.session.active.phase !== "followup"; index++) snapshot = await action({ type: "next-phase" });
    assert.equal(snapshot.session.active.phase, "followup");
    assert.equal(snapshot.session.active.followUp.questions.length, 0);
    await chat("!hoi", { userId: "codex-other-synthetic-viewer", nickname: "Người kiểm thử khác" }, "synthetic-wrong-viewer");
    assert.equal((await state()).session.active.followUp.questions.length, 0);
    assert.ok(!(await state()).session.active.followUp.awaitingQuestion);
    await action({ type: "followup-ask", readingId, userId: "codex-other-synthetic-viewer", question: questions[0] }, 400);
    result.wrongViewerRejected = true;
    for (let index = 0; index < questions.length; index++) {
      const start = Date.now();
      const callsBeforeTrigger = requestCount;
      await chat("!hoi");
      const waiting = (await state()).session.active.followUp;
      assert.equal(waiting.awaitingQuestion, true);
      assert.equal(waiting.questions.length, index);
      assert.equal(requestCount, callsBeforeTrigger, "Bare !hoi must not call AI.");
      await chat(questions[index], syntheticIdentity, index ? `synthetic-question-${index}` : undefined);
      assert.equal((await state()).session.active.followUp.awaitingQuestion, false);
      if (index === 0) {
        await chat(questions[index]);
        assert.equal((await state()).session.active.followUp.questions.length, 1);
        result.duplicateWithoutMsgIdIgnored = true;
      }
      let answered;
      while (Date.now() - start < 35000) {
        const reading = (await state()).session.active;
        assert.equal(reading?.id, readingId);
        assert.deepEqual(reading.cards, originalCards);
        assert.deepEqual(reading.content, originalContent);
        const item = reading.followUp.questions[index];
        assert.ok(item, "Synthetic follow-up was not queued.");
        if (item.status === "failed") throw new Error(item.error || "Follow-up AI failed.");
        if (item.status === "answered") { answered = item; break; }
        await wait(150);
      }
      assert.ok(answered, `Question ${index + 1} timed out.`);
      assert.ok(words(answered.answer) >= 20 && words(answered.answer) <= 70);
      assert.match(answered.answer, /[.!?]$/u);
      result.followUps.push({ question: answered.question, answer: answered.answer, words: words(answered.answer), elapsedMs: Date.now() - start });
      if (index === 0 && hold) {
        await action({ type: "pause" });
        console.log(`HOLD_READY ${JSON.stringify({ origin, readingId, phase: "answer", paused: true, maxHoldMs: 45000 })}`);
        const holdStart = Date.now();
        await wait(45000);
        result.uiHoldMs = Date.now() - holdStart;
        snapshot = await state();
        if (snapshot.session.active?.paused) await action({ type: "resume" });
      }
      if (index === 2) {
        const before = requestCount;
        await chat("!hoi", syntheticIdentity, "synthetic-fourth-trigger");
        await chat("Tôi có thể hỏi thêm câu thứ tư được không?", syntheticIdentity, "synthetic-fourth");
        await action({ type: "followup-ask", readingId, userId: syntheticIdentity.userId, question: "Tôi có thể hỏi thêm câu thứ tư được không?" }, 400);
        assert.equal((await state()).session.active.followUp.questions.length, 3);
        assert.equal(requestCount, before);
        result.fourthQuestionRejected = true;
      }
      snapshot = await state();
      if (snapshot.session.active.phase === "answer") snapshot = await action({ type: "next-phase" });
      assert.equal(snapshot.session.active.phase, index === 2 ? "complete" : "followup");
    }
    assert.equal(snapshot.session.active.followUp.closedReason, "answered");
    assert.deepEqual(snapshot.session.active.cards, originalCards);
    assert.deepEqual(snapshot.session.active.content, originalContent);
    assert.equal(requestCount, 4, "Exactly one main call and three follow-up calls are expected.");
    await action({ type: "next-phase" });
    const completed = await state();
    assert.equal(completed.session.active, null);
    assert.equal(completed.session.recentReadings[0].id, readingId);
    assert.equal(completed.session.recentReadings[0].followUp.questions.filter((item) => item.status === "answered").length, 3);
    result.cardsAndOriginalContextUnchanged = true;
    result.completed = true;
    result.apiRequests = requestCount;
    result.ok = true;
    if (historyHold) {
      console.log(`HISTORY_READY ${JSON.stringify({ origin, readingId, answers: 3, maxHoldMs: 12000 })}`);
      await wait(12000);
    }
  } catch (error) {
    result.error = sanitize(error.message);
    result.apiRequests = requestCount;
    process.exitCode = 1;
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await Promise.race([exited, wait(3000)]);
      if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; }
    }
    if (fixture) {
      assert.equal(dirname(resolve(fixture)), resolve(temporaryRoot));
      await rm(fixture, { recursive: true, force: true });
    }
    await mkdir(dirname(output), { recursive: true });
    const safe = JSON.stringify(result, null, 2);
    assert.ok(!secret || !safe.includes(secret), "Refusing to write secret-bearing results.");
    await writeFile(output, safe + "\n");
    console.log(safe);
  }
}
