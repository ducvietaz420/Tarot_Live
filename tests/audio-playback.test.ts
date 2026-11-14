import test from "node:test";
import assert from "node:assert/strict";
import {
  ContinuousPlayback,
  type PlaybackEnvironment,
  type AudioSignature,
} from "../src/speech-playback.ts";

const text =
  "Bạn có thể lắng nghe điều đang diễn ra trong lòng mình mà không vội đưa ra kết luận. Hãy chọn một cuộc trò chuyện nhẹ nhàng, nói rõ nhu cầu và dành thời gian quan sát phản hồi thực tế. Khi đã hiểu điều quan trọng với mình, bạn có thể quyết định bước tiếp theo một cách bình tĩnh hơn.";
const signature: AudioSignature = {
  readingId: "reading-test",
  phase: "card1",
  generation: 1,
};
function harness(provider: "browser" | "http" = "browser", voice = true) {
  const utterances: SpeechSynthesisUtterance[] = [];
  const audio: HTMLAudioElement[] = [];
  const messages: Record<string, unknown>[] = [];
  const timers = new Map<ReturnType<typeof setInterval>, () => void>();
  const requests: {
    signature: AudioSignature;
    signal: AbortSignal;
    resolve: (result: { url: string; text: string }) => void;
  }[] = [];
  let cancel = 0,
    pause = 0,
    resume = 0,
    audioPlays = 0,
    audioPauses = 0,
    serial = 0,
    clock = 0;
  const environment: PlaybackEnvironment = {
    createUtterance: (value) => {
      const u = {
        text: value,
        onstart: null,
        onboundary: null,
        onend: null,
        onerror: null,
      } as unknown as SpeechSynthesisUtterance;
      utterances.push(u);
      return u;
    },
    speak: () => {},
    cancelSpeech: () => {
      cancel++;
    },
    pauseSpeech: () => {
      pause++;
    },
    resumeSpeech: () => {
      resume++;
    },
    createAudio: (url) => {
      const player = {
        src: url,
        currentTime: 0,
        duration: 40,
        onloadedmetadata: null,
        onplay: null,
        onended: null,
        onerror: null,
        ontimeupdate: null,
        play: async () => {
          audioPlays++;
          player.onplay?.call(player, {} as Event);
        },
        pause: () => {
          audioPauses++;
        },
      } as unknown as HTMLAudioElement;
      audio.push(player);
      return player;
    },
    requestAudio: (signature, signal) =>
      new Promise((resolve) => requests.push({ signature, signal, resolve })),
    every: (fn) => {
      const id = ++serial as unknown as ReturnType<typeof setInterval>;
      timers.set(id, fn);
      return id;
    },
    clearEvery: (id) => {
      timers.delete(id);
    },
    now: () => clock,
  };
  const player = new ContinuousPlayback({
    signature,
    text,
    provider,
    voice: voice
      ? ({ name: "Vietnamese voice" } as SpeechSynthesisVoice)
      : undefined,
    rate: 0.95,
    volume: 0.85,
    environment,
    emit: (message) => messages.push(message),
    status: () => {},
  });
  return {
    player,
    utterances,
    audio,
    messages,
    timers,
    requests,
    advance: (ms: number) => {
      clock += ms;
      for (const tick of [...timers.values()]) tick();
    },
    counters: () => ({ cancel, pause, resume, audioPlays, audioPauses }),
  };
}
const start = (u: SpeechSynthesisUtterance) =>
  u.onstart?.call(u, {} as SpeechSynthesisEvent);
const boundary = (u: SpeechSynthesisUtterance, index: number) =>
  u.onboundary?.call(u, { charIndex: index } as SpeechSynthesisEvent);
const end = (u: SpeechSynthesisUtterance) =>
  u.onend?.call(u, {} as SpeechSynthesisEvent);
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("Browser đọc toàn bộ một lá trong đúng một utterance, không chia theo trang", () => {
  const h = harness();
  h.player.start();
  h.player.start();
  assert.equal(h.utterances.length, 1);
  assert.equal(h.utterances[0].text, text);
  start(h.utterances[0]);
  boundary(h.utterances[0], text.indexOf("Hãy chọn"));
  assert.equal(
    h.messages.filter((m) => m.type === "audio-progress").at(-1)?.charIndex,
    text.indexOf("Hãy chọn"),
  );
  for (const tick of h.timers.values()) tick();
  assert.equal(
    h.messages.filter((m) => m.type === "audio-heartbeat").length,
    1,
  );
  end(h.utterances[0]);
  end(h.utterances[0]);
  assert.equal(h.messages.filter((m) => m.type === "audio-done").length, 1);
  assert.equal(h.timers.size, 0);
  assert.equal(h.utterances.length, 1);
  h.player.dispose();
  assert.equal(h.counters().cancel, 0);
});

test("Pause/resume giữ native utterance, generation mới nhận đúng kết thúc, skip bỏ callback cũ", () => {
  const h = harness();
  h.player.start();
  const u = h.utterances[0];
  start(u);
  boundary(u, 30);
  h.player.pause({ ...signature, generation: 2 });
  assert.equal(h.player.state, "paused");
  assert.equal(h.timers.size, 0);
  assert.equal(h.counters().pause, 1);
  h.player.resume({ ...signature, generation: 3 });
  assert.equal(h.utterances.length, 1);
  assert.equal(h.player.state, "playing");
  assert.equal(h.counters().resume, 2);
  end(u);
  assert.equal(h.messages.find((m) => m.type === "audio-done")?.generation, 3);
  const skipped = harness();
  skipped.player.start();
  start(skipped.utterances[0]);
  skipped.player.dispose();
  boundary(skipped.utterances[0], 50);
  end(skipped.utterances[0]);
  assert.equal(
    skipped.messages.filter((m) => m.type === "audio-done").length,
    0,
  );
  assert.equal(skipped.timers.size, 0);
  assert.equal(skipped.counters().cancel, 1);
});

test("Nếu native pause không giữ được lời đọc, tiếp tục từ đầu câu đang đọc thay vì giữa cụm", () => {
  const h = harness();
  h.player.start();
  const u = h.utterances[0];
  start(u);
  const sentenceStart = text.indexOf("Hãy chọn");
  boundary(u, sentenceStart + 20);
  h.player.pause({ ...signature, generation: 2 });
  u.onerror?.call(u, { error: "interrupted" } as SpeechSynthesisErrorEvent);
  h.player.resume({ ...signature, generation: 3 });
  assert.equal(h.utterances.length, 2);
  assert.equal(h.utterances[1].text, text.slice(sentenceStart));
  assert.ok(h.utterances[1].text.startsWith("Hãy chọn một cuộc trò chuyện"));
  h.player.dispose();
});

test("HTTP TTS yêu cầu một file đầy đủ, pause/resume không tạo request cho từng trang", async () => {
  const h = harness("http");
  h.player.start();
  assert.equal(h.requests.length, 1);
  assert.deepEqual(h.requests[0].signature, signature);
  assert.equal("segmentIndex" in h.requests[0].signature, false);
  h.requests[0].resolve({ url: "/audio/full.wav", text });
  await flush();
  assert.equal(h.audio.length, 1);
  assert.equal(h.counters().audioPlays, 1);
  h.audio[0].currentTime = 12;
  h.audio[0].ontimeupdate?.call(h.audio[0], {} as Event);
  assert.equal(
    h.messages.filter((m) => m.type === "audio-progress").at(-1)?.timing,
    "estimated",
  );
  h.player.pause({ ...signature, generation: 2 });
  h.player.resume({ ...signature, generation: 3 });
  assert.equal(h.requests.length, 1);
  assert.equal(h.audio[0].currentTime, 12);
  assert.equal(h.counters().audioPlays, 2);
  h.audio[0].onended?.call(h.audio[0], {} as Event);
  assert.equal(h.messages.filter((m) => m.type === "audio-done").length, 1);
  assert.equal(h.timers.size, 0);
  h.player.dispose();
});

test("Không có giọng hoặc kết quả TTS cũ sau pause không giữ timer hay phát vào generation mới", async () => {
  const missing = harness("browser", false);
  missing.player.start();
  assert.equal(missing.utterances.length, 0);
  assert.equal(missing.messages.at(-1)?.type, "audio-error");
  assert.equal(missing.timers.size, 0);
  const h = harness("http");
  h.player.start();
  h.player.pause({ ...signature, generation: 2 });
  assert.equal(h.requests[0].signal.aborted, true);
  h.player.resume({ ...signature, generation: 3 });
  assert.equal(h.requests.length, 2);
  h.requests[0].resolve({ url: "/audio/stale.wav", text });
  await flush();
  assert.equal(h.audio.length, 0);
  h.requests[1].resolve({ url: "/audio/current.wav", text });
  await flush();
  assert.equal(h.audio.length, 1);
  assert.equal(h.audio[0].src, "/audio/current.wav");
  h.player.dispose();
  h.audio[0].onended?.call(h.audio[0], {} as Event);
  assert.equal(h.messages.filter((m) => m.type === "audio-done").length, 0);
  assert.equal(h.timers.size, 0);
});

test("Native resume im lặng được khôi phục đúng một lần từ đầu câu hiện tại", () => {
  const h = harness();
  h.player.start();
  const old = h.utterances[0];
  start(old);
  const sentenceStart = text.indexOf("Hãy chọn");
  boundary(old, sentenceStart + 35);
  const staleEnd = old.onend;
  h.player.pause({ ...signature, generation: 2 });
  h.player.resume({ ...signature, generation: 3 });
  h.advance(2000);
  assert.equal(h.utterances.length, 1);
  h.advance(1000);
  assert.equal(h.utterances.length, 2);
  assert.equal(h.counters().cancel, 1);
  assert.equal(old.onboundary, null);
  assert.equal(old.onend, null);
  assert.equal(old.onerror, null);
  assert.equal(old.onstart, null);
  const recovered = h.utterances[1];
  assert.equal(recovered.text, text.slice(sentenceStart));
  staleEnd?.call(old, {} as SpeechSynthesisEvent);
  assert.equal(h.messages.filter((m) => m.type === "audio-done").length, 0);
  start(recovered);
  boundary(recovered, 8);
  h.advance(12000);
  assert.equal(h.utterances.length, 2);
  assert.equal(h.player.state, "playing");
  end(recovered);
  assert.equal(h.messages.filter((m) => m.type === "audio-done").length, 1);
  assert.equal(h.messages.find((m) => m.type === "audio-done")?.generation, 3);
  assert.equal(h.timers.size, 0);
});

test("Native resume có tiến độ thật không bị watchdog chia lại lời đọc", () => {
  const h = harness();
  h.player.start();
  const u = h.utterances[0];
  start(u);
  boundary(u, 35);
  h.player.pause({ ...signature, generation: 2 });
  h.player.resume({ ...signature, generation: 3 });
  boundary(u, 40);
  h.advance(15000);
  assert.equal(h.utterances.length, 1);
  assert.equal(h.counters().cancel, 0);
  assert.equal(h.player.state, "playing");
  end(u);
  assert.equal(h.messages.filter((m) => m.type === "audio-done").length, 1);
});

test("Khôi phục resume vẫn không có tiến độ thì dừng heartbeat, không lặp vô hạn", () => {
  const h = harness();
  h.player.start();
  const u = h.utterances[0];
  start(u);
  boundary(u, 30);
  h.player.pause({ ...signature, generation: 2 });
  h.player.resume({ ...signature, generation: 3 });
  h.advance(3000);
  assert.equal(h.utterances.length, 2);
  start(h.utterances[1]);
  h.advance(10000);
  assert.equal(h.player.state, "failed");
  assert.equal(h.timers.size, 0);
  assert.equal(h.messages.filter((m) => m.type === "audio-error").length, 1);
  assert.equal(h.counters().cancel, 2);
  h.advance(60000);
  assert.equal(h.utterances.length, 2);
  assert.equal(h.messages.filter((m) => m.type === "audio-done").length, 0);
});

test("Giọng trình duyệt không phát onstart được giới hạn 10 giây thay vì giữ sân khấu 180 giây", () => {
  const h = harness();
  h.player.start();
  const u = h.utterances[0];
  const staleStart = u.onstart;
  h.advance(9000);
  assert.equal(h.player.state, "loading");
  h.advance(1000);
  assert.equal(h.player.state, "failed");
  assert.equal(h.timers.size, 0);
  assert.equal(h.counters().cancel, 1);
  assert.equal(h.messages.filter((m) => m.type === "audio-error").length, 1);
  staleStart?.call(u, {} as SpeechSynthesisEvent);
  end(u);
  assert.equal(h.player.state, "failed");
  assert.equal(h.messages.filter((m) => m.type === "audio-done").length, 0);
});
