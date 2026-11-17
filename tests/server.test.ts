import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { createServer as createHTTPServer, request } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import type { Snapshot } from "../shared/types.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
async function unusedPort(): Promise<number> {
  const listener = createNetServer();
  await new Promise<void>((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const address = listener.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    listener.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}
async function until(
  predicate: () => boolean | Promise<boolean>,
  timeout = 4000,
) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await predicate()) return;
    await delay(20);
  }
  throw new Error("Hết thời gian chờ điều kiện kiểm thử server.");
}
type Peer = { socket: WebSocket; last?: Snapshot; received: number };
async function peer(url: string, origin: string): Promise<Peer> {
  const result: Peer = { socket: new WebSocket(url, { origin }), received: 0 };
  result.socket.on("message", (raw) => {
    result.last = JSON.parse(raw.toString()) as Snapshot;
    result.received++;
  });
  result.socket.on("error", () => {});
  try {
    await until(() => !!result.last);
  } catch (error) {
    result.socket.terminate();
    throw error;
  }
  return result;
}
async function stop(child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await until(() => child.exitCode !== null || child.signalCode !== null, 2500);
}

test(
  "HTTP/WS: Origin, phiên riêng, nhiều preview, audio lease và restart SQLite",
  { timeout: 25_000 },
  async (t) => {
    const temp = await mkdtemp(join(tmpdir(), "tarot-http-test-"));
    const port = await unusedPort();
    const origin = `http://127.0.0.1:${port}`;
    const sockets: WebSocket[] = [];
    const wave = Buffer.alloc(44 + 3200);
    wave.write("RIFF", 0);
    wave.writeUInt32LE(wave.length - 8, 4);
    wave.write("WAVEfmt ", 8);
    wave.writeUInt32LE(16, 16);
    wave.writeUInt16LE(1, 20);
    wave.writeUInt16LE(1, 22);
    wave.writeUInt32LE(16000, 24);
    wave.writeUInt32LE(32000, 28);
    wave.writeUInt16LE(2, 32);
    wave.writeUInt16LE(16, 34);
    wave.write("data", 36);
    wave.writeUInt32LE(3200, 40);
    let ttsHits = 0;
    let holdTTS = false;
    let releaseTTS: (() => void) | undefined;
    const utterances: string[] = [];
    const mockTTS = createHTTPServer(async (req, res) => {
      let raw = "";
      for await (const chunk of req) raw += chunk.toString();
      const body = JSON.parse(raw) as { text: string };
      utterances.push(body.text);
      ttsHits++;
      const respond = () => {
        if (!res.destroyed) {
          res.writeHead(200, { "Content-Type": "audio/wav" });
          res.end(wave);
        }
      };
      if (holdTTS) releaseTTS = respond;
      else respond();
    });
    await new Promise<void>((resolve, reject) => {
      mockTTS.once("error", reject);
      mockTTS.listen(0, "127.0.0.1", resolve);
    });
    const mockAddress = mockTTS.address();
    assert.ok(mockAddress && typeof mockAddress !== "string");
    const ttsURL = `http://127.0.0.1:${mockAddress.port}/tts`;
    let child: ChildProcess | undefined;
    let output = "";
    t.after(async () => {
      for (const socket of sockets) socket.terminate();
      await stop(child);
      releaseTTS?.();
      mockTTS.closeAllConnections();
      await new Promise<void>((resolve) => mockTTS.close(() => resolve()));
      assert.equal(dirname(resolve(temp)), resolve(tmpdir()));
      assert.ok(basename(temp).startsWith("tarot-http-test-"));
      await rm(temp, { recursive: true, force: true });
    });
    const state = async (mode = "demo"): Promise<Snapshot> => {
      const res = await fetch(`${origin}/api/state?mode=${mode}`);
      assert.equal(res.status, 200);
      return (await res.json()) as Snapshot;
    };
    const action = async (value: unknown, mode = "demo") =>
      fetch(`${origin}/api/action?mode=${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin },
        body: JSON.stringify(value),
      });
    const boot = async () => {
      output = "";
      child = spawn(
        process.execPath,
        ["--import", "tsx", join(root, "server/index.ts"), "--production"],
        {
          cwd: root,
          env: {
            ...process.env,
            PORT: String(port),
            DATA_PATH: join(temp, "state.sqlite"),
            TIKFINITY_AUTOCONNECT: "false",
            TIKFINITY_URL: "ws://127.0.0.1:1/",
            AI_API_KEY: "",
            AI_BASE_URL: "",
            TTS_URL: ttsURL,
            TTS_API_KEY: "",
          },
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      child.stdout?.on("data", (data) => {
        output = (output + data.toString()).slice(-3000);
      });
      child.stderr?.on("data", (data) => {
        output = (output + data.toString()).slice(-3000);
      });
      await until(async () => {
        if (child?.exitCode !== null || child?.signalCode !== null)
          throw new Error(`Server không khởi động: ${output}`);
        try {
          return (await fetch(`${origin}/api/state`)).status === 200;
        } catch {
          return false;
        }
      }, 7000);
    };
    await boot();
    assert.equal((await state()).connection.status, "disconnected");
    assert.equal((await state()).session.active, null);
    assert.equal((await state()).session.queue.length, 0);

    // Both read and mutation requests are gated. Host check prevents DNS rebinding.
    assert.equal(
      (
        await fetch(`${origin}/api/state`, {
          headers: { Origin: "https://outside.example" },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(`${origin}/api/action`, {
          method: "POST",
          headers: { Origin: "https://outside.example" },
          body: '{"type":"start"}',
        })
      ).status,
      403,
    );
    const hostStatus = await new Promise<number | undefined>(
      (resolve, reject) => {
        const req = request(
          `${origin}/api/state`,
          { headers: { Host: `outside.example:${port}` } },
          (res) => {
            res.resume();
            resolve(res.statusCode);
          },
        );
        req.on("error", reject);
        req.end();
      },
    );
    assert.equal(hostStatus, 403);
    const deniedSocket = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      origin: "https://outside.example",
    });
    sockets.push(deniedSocket);
    const accepted = await new Promise<boolean>((resolve) => {
      deniedSocket.once("open", () => resolve(true));
      deniedSocket.once("error", () => resolve(false));
    });
    assert.equal(accepted, false);

    // DEMO events cannot accidentally enter the LIVE session.
    assert.equal(
      (await action({ type: "demo", scenario: "seed" }, "live")).status,
      400,
    );
    assert.equal(
      (await action({ type: "demo", scenario: "seed" })).status,
      200,
    );
    assert.equal((await state()).session.queue.length, 10);
    assert.equal((await state("live")).session.queue.length, 0);
    const demo1 = await peer(
      `ws://127.0.0.1:${port}/ws?mode=demo&clientId=test-demo-owner`,
      origin,
    );
    sockets.push(demo1.socket);
    const preview = await peer(
      `ws://127.0.0.1:${port}/ws?mode=demo&clientId=test-preview-only`,
      origin,
    );
    sockets.push(preview.socket);
    const live = await peer(
      `ws://127.0.0.1:${port}/ws?mode=live&clientId=test-live-owner`,
      origin,
    );
    sockets.push(live.socket);
    await Promise.all([state(), state(), state("live")]);
    assert.equal((await state()).session.active, null);
    assert.equal((await state()).session.queue.length, 10);
    assert.equal(demo1.last?.audioOwner, null);
    assert.equal(preview.last?.audioOwner, null);

    demo1.socket.send(JSON.stringify({ type: "audio-claim" }));
    await until(() => demo1.last?.audioOwner === "test-demo-owner");
    preview.socket.send(JSON.stringify({ type: "audio-claim" }));
    live.socket.send(JSON.stringify({ type: "audio-claim" }));
    await delay(50);
    assert.equal((await state()).audioOwner, "test-demo-owner");
    assert.equal((await state("live")).audioOwner, null);
    preview.socket.send(JSON.stringify({ type: "audio-claim", transfer: true }));
    await until(() => preview.last?.audioOwner === "test-preview-only");
    demo1.socket.send(JSON.stringify({ type: "audio-release" }));
    live.socket.send(JSON.stringify({ type: "audio-claim", transfer: true }));
    await delay(50);
    assert.equal((await state()).audioOwner, "test-preview-only");
    assert.equal((await state("live")).audioOwner, null);
    preview.socket.send(JSON.stringify({ type: "audio-release" }));
    await until(() => preview.last?.audioOwner === null);
    live.socket.send(JSON.stringify({ type: "audio-claim" }));
    await until(() => live.last?.audioOwner === "test-live-owner");

    // Starting is a backend mutation; refresh/extra sockets only view fixed cards.
    assert.equal((await action({ type: "start" })).status, 200);
    const started = await state();
    assert.ok(started.session.active);
    assert.equal(
      started.session.queue.filter((q) => q.status === "reading").length,
      1,
    );
    const readingId = started.session.active.id;
    const cards = started.session.active.cards;
    const creditCount = started.session.credits.length;
    assert.equal(new Set(cards.map((card) => card.cardId)).size, 3);
    await state();
    await state();
    assert.deepEqual((await state()).session.active?.cards, cards);
    for (const socket of sockets) socket.terminate();
    await stop(child);
    child = undefined;
    await boot();
    const restored = await state();
    assert.equal(restored.session.active?.id, readingId);
    assert.equal(restored.session.active?.paused, true);
    assert.deepEqual(restored.session.active?.cards, cards);
    assert.equal(restored.session.queue.length, 10);
    assert.equal(restored.session.credits.length, creditCount);
    assert.equal(restored.audioOwner, null);
    assert.equal((await state("live")).session.queue.length, 0);
    assert.equal(
      (await state()).session.queue.filter((q) => q.status === "reading")
        .length,
      1,
    );

    // A new reading snapshots the selected HTTP provider. Paragraph requests are
    // coalesced/cached and stale generations cannot return audio after pause/skip.
    assert.equal((await action({ type: "skip" })).status, 200);
    assert.equal(
      (
        await action({
          type: "config",
          config: {
            ttsProvider: "http",
            displayWords: 65,
            summaryWords: 50,
            durations: { card: 60 },
          },
        })
      ).status,
      200,
    );
    assert.equal((await action({ type: "start" })).status, 200);
    for (let i = 0; i < 3; i++)
      assert.equal((await action({ type: "next-phase" })).status, 200);
    const ttsOwner = await peer(
      `ws://127.0.0.1:${port}/ws?mode=demo&clientId=test-tts-owner`,
      origin,
    );
    sockets.push(ttsOwner.socket);
    ttsOwner.socket.send(JSON.stringify({ type: "audio-claim" }));
    await until(() => ttsOwner.last?.audioOwner === "test-tts-owner");
    const speaking = (await state()).session.active!;
    assert.equal(speaking.phase, "card1");
    const payload = {
      readingId: speaking.id,
      phase: speaking.phase,
      generation: speaking.generation,
      segmentIndex: 0,
    };
    const outsider = await peer(
      `ws://127.0.0.1:${port}/ws?mode=demo&clientId=test-audio-outsider`,
      origin,
    );
    sockets.push(outsider.socket);
    outsider.socket.send(JSON.stringify({ type: "audio-start", ...payload }));
    await delay(30);
    assert.equal(
      (await state()).audioActive,
      false,
      "Preview không được giữ timer bằng tín hiệu âm thanh",
    );
    ttsOwner.socket.send(JSON.stringify({ type: "audio-start", ...payload }));
    await until(() => ttsOwner.last?.audioActive === true);
    outsider.socket.send(JSON.stringify({ type: "audio-done", ...payload }));
    outsider.socket.send(
      JSON.stringify({
        type: "audio-progress",
        ...payload,
        charIndex: 1,
        timing: "boundary",
      }),
    );
    await delay(30);
    assert.equal((await state()).audioActive, true);
    assert.equal((await state()).audioSegment, undefined);
    ttsOwner.socket.send(
      JSON.stringify({
        type: "audio-progress",
        ...payload,
        charIndex: 1,
        timing: "boundary",
      }),
    );
    await until(() => ttsOwner.last?.audioSegment?.charIndex === 1);
    outsider.socket.send(JSON.stringify({ type: "audio-claim", transfer: true }));
    await until(
      () =>
        outsider.last?.audioOwner === "test-audio-outsider" &&
        outsider.last.audioActive === true,
    );
    assert.equal((await state()).audioSegment, undefined);
    const transferredDuration = (await state()).session.active!.phaseDuration;
    ttsOwner.socket.send(JSON.stringify({ type: "audio-release" }));
    ttsOwner.socket.send(JSON.stringify({ type: "audio-done", ...payload }));
    ttsOwner.socket.send(JSON.stringify({ type: "audio-error", ...payload }));
    await delay(30);
    assert.equal((await state()).audioOwner, "test-audio-outsider");
    assert.equal((await state()).audioActive, true);
    assert.equal(
      (await state()).session.active!.phaseDuration,
      transferredDuration,
    );
    ttsOwner.socket.send(JSON.stringify({ type: "audio-claim", transfer: true }));
    await until(
      () =>
        ttsOwner.last?.audioOwner === "test-tts-owner" &&
        ttsOwner.last.audioActive === true,
    );
    ttsOwner.socket.send(JSON.stringify({ type: "audio-error", ...payload }));
    await until(() => ttsOwner.last?.audioActive === false);
    assert.equal((await state()).audioSegment, undefined);
    const speak = (body: unknown, clientId = "test-tts-owner") =>
      fetch(`${origin}/api/tts?mode=demo`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Audio-Client": clientId,
          Origin: origin,
        },
        body: JSON.stringify(body),
      });
    assert.equal((await speak(payload, "test-not-owner")).status, 409);
    assert.equal((await speak({ ...payload, segmentIndex: -1 })).status, 400);
    assert.equal(ttsHits, 0);
    const identical = await Promise.all([speak(payload), speak(payload)]);
    assert.deepEqual(
      identical.map((res) => res.status),
      [200, 200],
    );
    const audioResult = (await identical[0].json()) as {
      url: string;
      text: string;
    };
    assert.equal(ttsHits, 1);
    assert.equal(audioResult.text, utterances[0]);
    assert.ok(
      audioResult.text.length < speaking.content.cards[0].speech.length,
    );
    assert.equal((await speak(payload)).status, 200);
    assert.equal(ttsHits, 1);
    const served = await fetch(origin + audioResult.url);
    assert.equal(served.status, 200);
    assert.equal(served.headers.get("content-type"), "audio/wav");
    assert.deepEqual(Buffer.from(await served.arrayBuffer()), wave);
    const { segmentIndex: _segmentIndex, ...fullPayload } = payload;
    holdTTS = true;
    const displacedRequest = speak(fullPayload);
    await until(() => ttsHits === 2 && !!releaseTTS);
    outsider.socket.send(JSON.stringify({ type: "audio-claim", transfer: true }));
    await until(() => outsider.last?.audioOwner === "test-audio-outsider");
    releaseTTS!();
    assert.equal(
      (await displacedRequest).status,
      409,
      "Tab cũ không được nhận TTS sau khi đã chuyển nguồn",
    );
    holdTTS = false;
    releaseTTS = undefined;
    ttsOwner.socket.send(JSON.stringify({ type: "audio-claim", transfer: true }));
    await until(() => ttsOwner.last?.audioOwner === "test-tts-owner");
    const fullResponses = await Promise.all([
      speak(fullPayload),
      speak(fullPayload),
    ]);
    assert.deepEqual(
      fullResponses.map((response) => response.status),
      [200, 200],
    );
    assert.equal(
      ttsHits,
      2,
      "Toàn đoạn chỉ tổng hợp một file, không gọi theo trang hiển thị",
    );
    const fullAudio = (await fullResponses[0].json()) as {
      url: string;
      text: string;
    };
    assert.equal(fullAudio.text, speaking.content.cards[0].speech);
    assert.equal(utterances.at(-1), speaking.content.cards[0].speech);
    assert.equal((await speak(fullPayload)).status, 200);
    assert.equal(ttsHits, 2);
    holdTTS = true;
    const beforeDelayed = ttsHits;
    const delayed = speak({ ...payload, segmentIndex: 1 });
    await until(() => ttsHits === beforeDelayed + 1 && !!releaseTTS);
    assert.equal((await action({ type: "pause" })).status, 200);
    releaseTTS!();
    const stale = await delayed;
    assert.ok(
      stale.status >= 400,
      "Đoạn TTS cũ không được trả audio thành công sau pause",
    );
    assert.equal((await state()).session.active?.id, speaking.id);
    assert.equal((await state()).session.active?.paused, true);
    assert.equal((await action({ type: "skip" })).status, 200);
    assert.equal((await action({ type: "start" })).status, 200);
    assert.notEqual((await state()).session.active?.id, speaking.id);
    assert.equal((await speak(payload)).status, 409);
  },
);
