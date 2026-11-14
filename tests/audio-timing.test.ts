import test from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../server/engine.ts";
import { Store } from "../server/store.ts";

function fixture() {
  let now = 1_000_000;
  const engine = new Engine(new Store(":memory:"), {
    now: () => now,
    rng: () => 0,
  });
  engine.action({ type: "demo", scenario: "full" }, "demo");
  for (let index = 0; index < 3; index++) engine.advance("demo");
  engine.setAudioOwner("demo", "actual-audio-owner");
  const reading = engine.sessions.demo.active!;
  const signature = () =>
    [reading.id, reading.phase, reading.generation] as const;
  const tick = (ms: number) => {
    now += ms;
    engine.tick();
  };
  return { engine, reading, signature, tick };
}

test("Giọng đọc còn sống không bị timer cắt giữa đoạn, kết thúc thật chuyển sau nhịp ngắn", () => {
  const { engine, reading, signature, tick } = fixture();
  try {
    engine.audioStart("demo", ...signature());
    for (let second = 0; second < 70; second++) {
      engine.audioHeartbeat("demo", ...signature());
      tick(1000);
    }
    assert.equal(reading.phase, "card1");
    assert.equal(engine.snapshot("demo").audioActive, true);
    engine.audioDone("demo", ...signature());
    assert.equal(engine.snapshot("demo").audioActive, false);
    tick(799);
    assert.equal(reading.phase, "card1");
    tick(1);
    assert.equal(reading.phase, "card2");
  } finally {
    engine.close();
  }
});

test("Đọc xong sớm không để im lặng đến hết thời lượng mẫu 24 giây", () => {
  const { engine, reading, signature, tick } = fixture();
  try {
    assert.equal(reading.config.durations.card, 24);
    engine.audioStart("demo", ...signature());
    tick(2000);
    engine.audioDone("demo", ...signature());
    tick(800);
    assert.equal(reading.phase, "card2");
  } finally {
    engine.close();
  }
});

test("Mất heartbeat hoặc mất chủ âm thanh giải phóng lượt; heartbeat không giữ sân khấu vô hạn", () => {
  const lost = fixture();
  try {
    lost.engine.audioStart("demo", ...lost.signature());
    for (let second = 0; second < 40; second++) {
      lost.engine.audioHeartbeat("demo", ...lost.signature());
      lost.tick(1000);
    }
    lost.tick(6000);
    assert.equal(lost.reading.phase, "card2");
    assert.equal(lost.engine.snapshot("demo").audioActive, false);
  } finally {
    lost.engine.close();
  }
  const release = fixture();
  try {
    release.engine.audioStart("demo", ...release.signature());
    for (let second = 0; second < 40; second++) {
      release.engine.audioHeartbeat("demo", ...release.signature());
      release.tick(1000);
    }
    release.engine.setAudioOwner("demo", null);
    release.tick(1);
    assert.equal(release.reading.phase, "card2");
  } finally {
    release.engine.close();
  }
  const bounded = fixture();
  try {
    bounded.engine.audioStart("demo", ...bounded.signature());
    for (let second = 0; second < 179; second++) {
      bounded.engine.audioHeartbeat("demo", ...bounded.signature());
      bounded.tick(1000);
    }
    assert.equal(bounded.reading.phase, "card1");
    bounded.engine.audioHeartbeat("demo", ...bounded.signature());
    bounded.tick(1000);
    assert.equal(bounded.reading.phase, "card2");
  } finally {
    bounded.engine.close();
  }
});

test("Tiến độ là nguyên câu từ lời đọc; pause/skip/replay loại tín hiệu của generation cũ", () => {
  const { engine, reading, signature, tick } = fixture();
  try {
    const old = signature();
    engine.audioStart("demo", ...old);
    engine.audioProgress("demo", {
      readingId: old[0],
      phase: old[1],
      generation: old[2],
      charIndex: 1,
      timing: "boundary",
    });
    const first = engine.snapshot("demo").audioSegment!;
    assert.equal(first.text, "Nhìn lại điều đã qua.");
    assert.equal(first.charIndex, 1);
    assert.equal(first.timing, "boundary");
    engine.audioProgress("demo", {
      readingId: old[0],
      phase: old[1],
      generation: old[2],
      charIndex: -1,
      timing: "boundary",
    });
    assert.equal(engine.snapshot("demo").audioSegment?.charIndex, 1);
    engine.action({ type: "pause" }, "demo");
    assert.equal(engine.snapshot("demo").audioActive, false);
    assert.equal(engine.snapshot("demo").audioSegment, undefined);
    engine.action({ type: "resume" }, "demo");
    const duration = reading.phaseDuration;
    engine.audioStart("demo", ...old);
    engine.audioDone("demo", ...old);
    engine.audioHeartbeat("demo", ...old);
    assert.equal(reading.phaseDuration, duration);
    assert.equal(engine.snapshot("demo").audioActive, false);
    engine.audioStart("demo", ...signature());
    engine.audioProgress("demo", {
      readingId: reading.id,
      phase: reading.phase,
      generation: reading.generation,
      charIndex: reading.content.cards[0].speech.length,
      timing: "estimated",
    });
    assert.equal(engine.snapshot("demo").audioSegment?.timing, "estimated");
    const before = reading.replayCount || 0;
    engine.action({ type: "replay" }, "demo");
    assert.equal(reading.replayCount, before + 1);
    assert.equal(engine.snapshot("demo").audioActive, false);
    engine.audioStart("demo", ...signature());
    engine.audioError("demo", ...signature());
    assert.equal(engine.snapshot("demo").audioActive, false);
    assert.equal(engine.snapshot("demo").audioSegment, undefined);
    engine.action({ type: "skip" }, "demo");
    engine.action({ type: "start" }, "demo");
    const current = engine.sessions.demo.active!;
    assert.notEqual(current.id, old[0]);
    engine.audioStart("demo", ...old);
    engine.audioDone("demo", ...old);
    tick(1);
    assert.equal(current.phase, "locking");
    assert.equal(engine.snapshot("demo").audioActive, false);
  } finally {
    engine.close();
  }
});
