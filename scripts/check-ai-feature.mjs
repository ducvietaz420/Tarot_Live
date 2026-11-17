import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";

const requestMarker = "TAROT_AI_FEATURE_REQUEST";
const syntheticQuestion = "Trong tuần tới tôi nên tập trung điều gì trong công việc?";
const syntheticIdentity = { userId: "codex-ai-test", nickname: "Kiểm thử AI" };
const geminiEndpoint = "https://generativelanguage.googleapis.com/v1beta/openai";

// This branch runs only inside the disposable backend, before server/index.ts.
// Count actual Gemini requests without recording headers, prompts or responses.
if (process.env.TAROT_AI_FEATURE_PROBE === "true") {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    const request = args[0];
    const url = new URL(
      typeof request === "string" || request instanceof URL
        ? request
        : request.url,
    );
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") {
      assert.equal(url.href, geminiEndpoint + "/chat/completions", "Unexpected external test destination.");
      const body = JSON.parse(args[1]?.body || "{}");
      assert.equal(body.model, "gemini-3.5-flash-lite", "Unexpected test model.");
      assert.equal(body.messages.length, 2, "Unexpected prompt messages.");
      assert.equal(body.messages[0].role, "system");
      assert.equal(body.messages[1].role, "user");
      const payload = JSON.parse(body.messages[1].content);
      assert.deepEqual(Object.keys(payload).sort(), ["cards", "question", "topic"]);
      assert.equal(payload.question, syntheticQuestion, "Refusing to send a non-synthetic question.");
      assert.equal(payload.topic, "Công việc");
      assert.equal(payload.cards.length, 3);
      const { getCard } = await import("../shared/cards.ts");
      for (const card of payload.cards) {
        assert.deepEqual(Object.keys(card).sort(), ["cardId", "data", "position", "reversed"]);
        assert.deepEqual(card.data, getCard(card.cardId), "Refusing non-public card data.");
        assert.ok(Number.isInteger(card.position) && card.position >= 0 && card.position <= 2);
        assert.equal(typeof card.reversed, "boolean");
      }
      assert.ok(!args[1].body.includes(process.env.AI_API_KEY), "Credentials must never appear in prompt content.");
      console.log(requestMarker);
    }
    return originalFetch(...args);
  };
} else {
  await checkFeature();
}

async function checkFeature() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const temporaryRoot = join(root, "tmp");
  const requestedOutput = process.argv.find((arg) => arg.startsWith("--output="))
    ?.slice("--output=".length) ?? "qa/ai-feature-check.json";
  assert.ok(requestedOutput && !isAbsolute(requestedOutput) && !/^[a-z]:/iu.test(requestedOutput), "Output must be a repository-relative JSON path inside qa/.");
  const resultPath = resolve(root, requestedOutput);
  const relativeOutput = relative(join(root, "qa"), resultPath);
  assert.ok(relativeOutput && relativeOutput !== ".." && !relativeOutput.startsWith(".." + sep) && !isAbsolute(relativeOutput), "Output must stay inside qa/.");
  assert.equal(extname(resultPath).toLowerCase(), ".json", "Output must be a JSON file.");
  const model = process.argv.find((arg) => arg.startsWith("--model="))
    ?.slice("--model=".length) || "gemini-3.5-flash-lite";
  assert.equal(model, "gemini-3.5-flash-lite", "This fixture permits one explicit Gemini model.");
  const preflight = {
    destination: geminiEndpoint + "/chat/completions",
    model,
    syntheticUser: syntheticIdentity,
    syntheticQuestion,
    content: "Fixed synthetic DEMO question and public card metadata bundled in shared/cards.ts; no live database, private user data or headers in logs.",
    outgoingGuard: "Exact endpoint, model, question, topic and public card records are checked before external fetch.",
  };
  console.log(JSON.stringify({ preflight }, null, 2));
  if (process.argv.includes("--preflight")) return;
  const origin = "http://127.0.0.1:54323";
  let secret = "";
  let fixture;
  let child;
  let requestCount = 0;
  let childOutput = "";
  const result = {
    checkedAt: new Date().toISOString(),
    ok: false,
    provider: "Gemini",
    model,
    isolatedPort: 54323,
    envModelConfigured: false,
    disabled: null,
    enabled: null,
  };
  const sanitize = (message) => {
    const text = String(message);
    return (secret ? text.replaceAll(secret, "[redacted]") : text).slice(0, 700);
  };
  const wait = (ms) => new Promise((complete) => setTimeout(complete, ms));
  const state = async () => {
    const response = await fetch(`${origin}/api/state?mode=demo`, {
      signal: AbortSignal.timeout(2000),
    });
    assert.equal(response.status, 200, "Test state request failed.");
    return response.json();
  };
  const action = async (value) => {
    const response = await fetch(`${origin}/api/action?mode=demo`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify(value),
      signal: AbortSignal.timeout(3000),
    });
    const snapshot = await response.json();
    if (!response.ok)
      throw new Error(`Test action failed: ${snapshot.error || response.status}`);
    return snapshot;
  };
  const words = (text) => text.trim().split(/\s+/u).filter(Boolean).length;
  try {
    // Fail if another process owns the test port; never use or stop that server.
    let existing = false;
    try {
      await fetch(`${origin}/api/state?mode=demo`, {
        signal: AbortSignal.timeout(500),
      });
      existing = true;
    } catch {}
    assert.equal(existing, false, "Test port 54323 is already occupied.");
    const env = parse(await readFile(join(root, "backend", ".env"), "utf8"));
    secret = env.AI_API_KEY || "";
    assert.ok(secret, "No Gemini key is stored in backend/.env.");
    assert.equal(
      env.AI_BASE_URL,
      geminiEndpoint,
      "The stored AI endpoint is not the Gemini compatibility endpoint.",
    );
    result.envModelConfigured = !!env.AI_MODEL;
    await mkdir(temporaryRoot, { recursive: true });
    fixture = await mkdtemp(join(temporaryRoot, "ai-feature-"));
    child = spawn(
      process.execPath,
      [
        "--import", "tsx",
        "--import", import.meta.url,
        join(root, "server", "index.ts"), "--production",
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          PORT: "54323",
          DATA_PATH: join(fixture, "state.sqlite"),
          TIKFINITY_AUTOCONNECT: "false",
          TIKFINITY_URL: "ws://127.0.0.1:1/",
          AI_API_KEY: secret,
          AI_BASE_URL: env.AI_BASE_URL,
          AI_JSON_MODE: env.AI_JSON_MODE || "true",
          AI_MODEL: env.AI_MODEL || "",
          TTS_URL: "",
          TTS_API_KEY: "",
          TAROT_AI_FEATURE_PROBE: "true",
        },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      requestCount += text.split(requestMarker).length - 1;
      childOutput = (childOutput + text).slice(-3000);
    });
    child.stderr.on("data", (chunk) => {
      childOutput = (childOutput + chunk.toString()).slice(-3000);
    });
    child.on("error", (error) => { childOutput += error.message; });
    const bootDeadline = Date.now() + 8000;
    let booted = false;
    while (Date.now() < bootDeadline) {
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error(`Test backend exited: ${sanitize(childOutput)}`);
      try { await state(); booted = true; break; } catch {}
      await wait(100);
    }
    assert.ok(booted, `Test backend did not become ready: ${sanitize(childOutput)}`);
    const initial = await state();
    assert.equal(initial.session.queue.length, 0, "Test database is not empty.");
    assert.equal(initial.capabilities.ai, true, "Backend did not load Gemini credentials.");
    await action({
      type: "config",
      config: {
        aiEnabled: false,
        aiModel: model,
        aiTimeoutSec: 30,
        joinMode: "free",
        cooldownSec: 0,
        autoRun: false,
        ttsProvider: "off",
        music: false,
        sfx: false,
        durations: { locking: 2, shuffling: 3, dealing: 2, card: 60, summary: 60, complete: 6 },
      },
    });
    const seedQuestion = () => action({
      type: "demo",
      scenario: "synthetic-fixture",
      envelope: {
        event: "chat",
        data: {
          ...syntheticIdentity,
          uniqueId: "codex_ai_test",
          msgId: `synthetic-${Date.now()}`,
          comment: `tarot công việc | ${syntheticQuestion}`,
        },
      },
    });
    await seedQuestion();
    const disabled = await action({ type: "start" });
    assert.equal(disabled.session.active.question, syntheticQuestion);
    assert.equal(disabled.session.active.content.source, "fallback");
    await wait(300);
    assert.equal(requestCount, 0, "AI-off unexpectedly sent a Gemini request.");
    result.disabled = { aiEnabled: false, source: "fallback", apiRequests: 0 };
    await action({ type: "skip" });
    await action({ type: "config", config: { aiEnabled: true } });
    await seedQuestion();
    const start = Date.now();
    const started = await action({ type: "start" });
    const expected = started.session.active.cards;
    assert.equal(started.session.active.question, syntheticQuestion);
    const readingId = started.session.active.id;
    let ready;
    while (Date.now() - start < 35000) {
      const snapshot = await state();
      const reading = snapshot.session.active;
      assert.ok(reading && reading.id === readingId, "Reading changed during AI generation.");
      assert.deepEqual(reading.cards, expected, "AI changed the selected cards.");
      if (reading.content.source === "ai") { ready = reading; break; }
      if (reading.content.error) throw new Error(reading.content.error);
      await wait(200);
    }
    assert.ok(ready, "AI-on did not produce AI content before the timeout.");
    const cardResults = ready.content.cards.map((card, index) => {
      const metadata = { cardId: card.cardId, position: card.position, reversed: card.reversed };
      assert.deepEqual(metadata, expected[index], "AI content card metadata changed.");
      const count = words(card.text);
      assert.ok(count >= 30 && count <= ready.config.displayWords, "AI card text has an invalid word count after whole-sentence clipping.");
      assert.match(card.text, /[.!?][”"')\]]*$/u, "AI card ends mid-sentence.");
      assert.equal(card.speech, card.text, "AI speech differs from display text.");
      return { ...metadata, words: count };
    });
    const summaryWords = words(ready.content.summary);
    assert.ok(summaryWords >= 20 && summaryWords <= ready.config.summaryWords, "AI summary word count is invalid after whole-sentence clipping.");
    assert.match(ready.content.summary, /[.!?][”"')\]]*$/u, "AI summary ends mid-sentence.");
    assert.equal(requestCount, 1, "AI-on should issue one Gemini request for this reading.");
    result.enabled = {
      aiEnabled: true,
      source: ready.content.source,
      elapsedMs: Date.now() - start,
      apiRequests: requestCount,
      cardsUnchanged: true,
      cards: cardResults,
      summaryWords,
    };
    result.ok = true;
  } catch (error) {
    result.error = sanitize(error.message);
    process.exitCode = 1;
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await Promise.race([exited, wait(3000)]);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await exited;
      }
    }
    if (fixture) {
      assert.equal(dirname(resolve(fixture)), resolve(temporaryRoot));
      assert.ok(resolve(fixture).startsWith(resolve(temporaryRoot) + "/") || resolve(fixture).startsWith(resolve(temporaryRoot) + "\\"));
      await rm(fixture, { recursive: true, force: true });
    }
    await mkdir(dirname(resultPath), { recursive: true });
    const safeResult = JSON.stringify(result, null, 2);
    assert.ok(!secret || !safeResult.includes(secret), "Refusing to write secret-bearing results.");
    await writeFile(resultPath, safeResult + "\n");
    console.log(safeResult);
  }
}
