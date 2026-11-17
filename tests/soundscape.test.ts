import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as afterMicrotasks } from "node:timers/promises";
import { TarotSoundscape } from "../src/soundscape.ts";

class FakeParam {
  value = 1;
  targets: { value: number; time: number; constant: number }[] = [];
  cancellations: number[] = [];
  setValueAtTime(value: number, _time: number) {
    this.value = value;
  }
  setTargetAtTime(value: number, time: number, constant: number) {
    this.value = value;
    this.targets.push({ value, time, constant });
  }
  cancelScheduledValues(time: number) {
    this.cancellations.push(time);
  }
}

class FakeGain {
  gain = new FakeParam();
  disconnected = false;
  connect(destination: object) {
    return destination;
  }
  disconnect() {
    this.disconnected = true;
  }
}

class FakeSource {
  buffer: AudioBuffer | null = null;
  loop = false;
  onended: (() => void) | null = null;
  gain: FakeGain | null = null;
  starts = 0;
  stops: (number | undefined)[] = [];
  disconnected = false;
  connect(gain: FakeGain) {
    this.gain = gain;
    return gain;
  }
  start() {
    this.starts++;
  }
  stop(time?: number) {
    // Native Web Audio dispatches ended later, not from inside stop().
    this.stops.push(time);
  }
  end() {
    this.onended?.();
  }
  disconnect() {
    this.disconnected = true;
  }
}

class FakeContext {
  currentTime = 12;
  destination = {};
  sources: FakeSource[] = [];
  gains: FakeGain[] = [];
  createBufferSource() {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
  createGain() {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
}

function buffer(seconds = 2.4) {
  return { duration: seconds } as AudioBuffer;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function fixture(loader?: (url: string) => Promise<AudioBuffer>) {
  const context = new FakeContext();
  const requests: string[] = [];
  const scene = new TarotSoundscape(
    context as unknown as AudioContext,
    async (url) => {
      requests.push(url);
      return loader ? loader(url) : buffer(url.includes("ambient") ? 64 : 2.4);
    },
  );
  return { context, scene, requests };
}

test("Nhạc nền nối vòng, tự hạ còn 40% khi đọc và đổi âm lượng không tạo nguồn trùng", async () => {
  const { context, scene, requests } = fixture();
  try {
    await scene.setMusic(true, 0.25, false);
    const music = context.sources[0];
    assert.equal(music.loop, true);
    assert.equal(music.starts, 1);
    assert.equal(music.gain?.gain.value, 0.25);
    await scene.setMusic(true, 0.25, true);
    assert.equal(music.gain?.gain.value, 0.1);
    await scene.setMusic(true, 0.15, false);
    assert.equal(music.gain?.gain.value, 0.15);
    assert.equal(context.sources.length, 1);
    assert.deepEqual(requests, ["/assets/audio/tarot-ambient.wav"]);
  } finally {
    scene.dispose();
  }
});

test("Âm lượng xào bài độc lập với nhạc, cập nhật hiệu ứng không thay nguồn nhạc", async () => {
  const { context, scene } = fixture();
  try {
    await scene.setMusic(true, 0.2, true);
    const effect = scene.playEffect("shuffle", 0.7, 3);
    await afterMicrotasks();
    const [music, shuffle] = context.sources;
    assert.ok(Math.abs(music.gain!.gain.value - 0.08) < 1e-12);
    assert.equal(shuffle.gain?.gain.value, 0.7);
    assert.equal(shuffle.loop, true, "Shuffle must cover a phase longer than its sample");
    assert.deepEqual(shuffle.stops, [15]);
    scene.setEffectVolume(0.45);
    assert.equal(shuffle.gain?.gain.value, 0.45);
    assert.ok(Math.abs(music.gain!.gain.value - 0.08) < 1e-12);
    shuffle.end();
    assert.equal(await effect, true);
  } finally {
    scene.dispose();
  }
});

test("Chuyển pha dừng hiệu ứng cũ, trả false khi hủy và true khi hiệu ứng mới kết thúc", async () => {
  const { context, scene, requests } = fixture();
  try {
    const first = scene.playEffect("shuffle", 0.65);
    await afterMicrotasks();
    const shuffle = context.sources[0];
    const oldEnded = shuffle.onended;
    const second = scene.playEffect("deal", 0.5, 0.38);
    assert.equal(await first, false);
    assert.equal(shuffle.gain?.gain.value, 0);
    assert.equal(shuffle.disconnected, true);
    assert.equal(shuffle.gain?.disconnected, true);
    await afterMicrotasks();
    const deal = context.sources[1];
    assert.equal(deal.loop, false);
    assert.deepEqual(requests, ["/assets/audio/card-shuffle.wav", "/assets/audio/card-deal.wav"]);
    oldEnded?.();
    assert.equal(deal.disconnected, false, "A late ended event must not stop the replacement");
    deal.end();
    assert.equal(await second, true);
    assert.equal(deal.disconnected, true);
  } finally {
    scene.dispose();
  }
});

test("Hủy hiệu ứng đang tải ngăn phát muộn; lần phát sau dùng lại buffer đã tải", async () => {
  const pending = deferred<AudioBuffer>();
  const { context, scene, requests } = fixture(() => pending.promise);
  try {
    const cancelled = scene.playEffect("shuffle", 0.7);
    scene.stopEffects();
    pending.resolve(buffer());
    assert.equal(await cancelled, false);
    assert.equal(context.sources.length, 0);
    const next = scene.playEffect("shuffle", 0.6);
    await afterMicrotasks();
    assert.equal(context.sources.length, 1);
    assert.equal(requests.length, 1);
    context.sources[0].end();
    assert.equal(await next, true);
  } finally {
    scene.dispose();
  }
});

test("Pha mới đang tải thay thế pha cũ trước khi hai file tải xong", async () => {
  const shuffleBuffer = deferred<AudioBuffer>();
  const dealBuffer = deferred<AudioBuffer>();
  const { context, scene } = fixture((url) => url.includes("shuffle") ? shuffleBuffer.promise : dealBuffer.promise);
  try {
    const shuffle = scene.playEffect("shuffle", 0.7);
    const deal = scene.playEffect("deal", 0.5);
    shuffleBuffer.resolve(buffer());
    assert.equal(await shuffle, false);
    assert.equal(context.sources.length, 0);
    dealBuffer.resolve(buffer(0.38));
    await afterMicrotasks();
    assert.equal(context.sources.length, 1);
    assert.equal(context.sources[0].buffer?.duration, 0.38);
    context.sources[0].end();
    assert.equal(await deal, true);
  } finally {
    scene.dispose();
  }
});

test("Tắt nhạc trong lúc tải ngăn nguồn phát muộn", async () => {
  const pending = deferred<AudioBuffer>();
  const { context, scene } = fixture(() => pending.promise);
  try {
    const start = scene.setMusic(true, 0.2, false);
    scene.stopMusic();
    pending.resolve(buffer(64));
    await start;
    assert.equal(context.sources.length, 0);
    await scene.setMusic(true, 0.2, false);
    assert.equal(context.sources.length, 1);
  } finally {
    scene.dispose();
  }
});

test("Cập nhật nhạc khi đang tải chỉ khởi tạo một loop với mức âm mới nhất", async () => {
  const pending = deferred<AudioBuffer>();
  const { context, scene, requests } = fixture(() => pending.promise);
  try {
    const first = scene.setMusic(true, 0.25, false);
    const latest = scene.setMusic(true, 0.15, true);
    pending.resolve(buffer(64));
    await Promise.all([first, latest]);
    assert.equal(requests.length, 1);
    assert.equal(context.sources.length, 1);
    assert.equal(context.sources[0].gain?.gain.value, 0.06);
  } finally {
    scene.dispose();
  }
});

test("Dispose khi file đang tải không cho nhạc hay hiệu ứng tự bật lại", async () => {
  const pending = deferred<AudioBuffer>();
  const { context, scene, requests } = fixture(() => pending.promise);
  const music = scene.setMusic(true, 0.2, false);
  const effect = scene.playEffect("shuffle", 0.7);
  scene.dispose();
  pending.resolve(buffer(64));
  await music;
  assert.equal(await effect, false);
  assert.equal(context.sources.length, 0);
  await scene.setMusic(true, 0.2, false);
  assert.equal(await scene.playEffect("deal", 0.5), false);
  assert.equal(requests.length, 2);
});

test("Tắt nhạc và dispose ngắt nguồn đang chạy, không dừng nhầm hiệu ứng độc lập", async () => {
  const { context, scene } = fixture();
  await scene.setMusic(true, 0.2, false);
  const effect = scene.playEffect("shuffle", 0.7);
  await afterMicrotasks();
  const [music, shuffle] = context.sources;
  await scene.setMusic(false, 0.2, false);
  assert.equal(music.disconnected, true);
  assert.equal(shuffle.disconnected, false);
  scene.dispose();
  assert.equal(await effect, false);
  assert.equal(shuffle.disconnected, true);
  assert.equal(shuffle.gain?.gain.value, 0);
  assert.equal(music.onended, null);
  assert.equal(shuffle.onended, null);
});

test("Âm lượng 0, âm lượng không hợp lệ hoặc thời lượng 0 không tạo nguồn phát", async () => {
  const { context, scene, requests } = fixture();
  try {
    await scene.setMusic(true, 0, false);
    await scene.setMusic(true, Number.NaN, false);
    assert.equal(await scene.playEffect("shuffle", 0), false);
    assert.equal(await scene.playEffect("deal", -1), false);
    assert.equal(requests.length, 0);
    assert.equal(await scene.playEffect("shuffle", 0.5, 0), false);
    assert.equal(await scene.playEffect("shuffle", 0.5, Number.POSITIVE_INFINITY), false);
    assert.equal(context.sources.length, 0);
    await scene.setMusic(true, 10, false);
    assert.equal(context.sources[0].gain?.gain.value, 1);
  } finally {
    scene.dispose();
  }
});

test("Tải file lỗi có thể thử lại, preload dùng chung cache với lần phát sau", async () => {
  let fail = true;
  const { context, scene, requests } = fixture(async (url) => {
    if (url.includes("shuffle") && fail) {
      fail = false;
      throw new Error("audio unavailable");
    }
    return buffer(url.includes("ambient") ? 64 : 2.4);
  });
  try {
    await assert.rejects(scene.playEffect("shuffle", 0.7), /audio unavailable/);
    assert.equal(context.sources.length, 0);
    await scene.preload();
    assert.equal(requests.filter((url) => url.includes("shuffle")).length, 2);
    const count = requests.length;
    const effect = scene.playEffect("shuffle", 0.7);
    await afterMicrotasks();
    context.sources[0].end();
    assert.equal(await effect, true);
    await scene.setMusic(true, 0.2, false);
    assert.equal(requests.length, count);
  } finally {
    scene.dispose();
  }
});
