import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

// Original, deterministic synthesis: no recordings, samples or network sources.
const sampleRate = 32000;
const output = new URL("../public/assets/audio/", import.meta.url);
const tau = Math.PI * 2;
let seed = 0x7461726f;
function random() {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return (seed >>> 0) / 0x100000000;
}
const db = (amplitude) => 20 * Math.log10(Math.max(1e-12, amplitude));
const noteHz = (midi) => 440 * 2 ** ((midi - 69) / 12);
const smooth = (x) => {
  const u = Math.max(0, Math.min(1, x));
  return u * u * (3 - 2 * u);
};
const channels = (seconds, count = 1) =>
  Array.from({ length: count }, () => new Float64Array(Math.round(seconds * sampleRate)));

function addEvent(target, start, duration, render, circular = false) {
  const first = Math.round(start * sampleRate);
  const count = Math.round(duration * sampleRate);
  for (let index = 0; index < count; index++) {
    let frame = first + index;
    if (circular) frame = ((frame % target[0].length) + target[0].length) % target[0].length;
    if (frame < 0 || frame >= target[0].length) continue;
    const value = render(index / sampleRate, index / count);
    for (let channel = 0; channel < target.length; channel++)
      target[channel][frame] += Array.isArray(value) ? value[channel] : value;
  }
}

function paperNoise(length, low = 450, high = 4300) {
  const result = new Float64Array(length);
  const highAlpha = 1 - Math.exp((-tau * high) / sampleRate);
  const lowAlpha = 1 - Math.exp((-tau * low) / sampleRate);
  let upper = 0;
  let lower = 0;
  for (let index = 0; index < length; index++) {
    const white = random() * 2 - 1;
    upper += highAlpha * (white - upper);
    lower += lowAlpha * (white - lower);
    result[index] = upper - lower;
  }
  return result;
}

function paperSwipe(target, start, duration, strength, speed = 26) {
  const noise = paperNoise(Math.round(duration * sampleRate), 420, 5200);
  const phase = random() * tau;
  addEvent(target, start, duration, (time, u) => {
    const envelope = Math.sin(Math.PI * u) ** 1.25;
    const flutter = 0.68 + 0.32 * Math.sin(tau * speed * time + phase) ** 2;
    return noise[Math.min(noise.length - 1, Math.floor(time * sampleRate))] * envelope * flutter * strength;
  });
}

function paperRiffle(target, start, flips, spacing, strength) {
  for (let flip = 0; flip < flips; flip++) {
    const at = start + flip * spacing + (random() - 0.5) * 0.003;
    const duration = 0.025 + random() * 0.016;
    const noise = paperNoise(Math.round(duration * sampleRate), 900, 6800);
    const weight = strength * (0.75 + random() * 0.5);
    addEvent(target, at, duration, (time) => {
      const attack = smooth(time / 0.0012);
      const release = Math.exp(-time / 0.0105);
      const index = Math.min(noise.length - 1, Math.floor(time * sampleRate));
      return weight * attack * release * (noise[index] + 0.08 * Math.sin(tau * 175 * time));
    });
  }
}

function cardTap(target, start, strength) {
  const duration = 0.075;
  const noise = paperNoise(Math.round(duration * sampleRate), 150, 1800);
  addEvent(target, start, duration, (time) => {
    const envelope = smooth(time / 0.001) * Math.exp(-time / 0.015);
    const tone = Math.sin(tau * 160 * time) + 0.28 * Math.sin(tau * 320 * time);
    return strength * envelope * (0.28 * tone + noise[Math.min(noise.length - 1, Math.floor(time * sampleRate))]);
  });
}

function makeShuffle() {
  const result = channels(2.4);
  paperSwipe(result, 0.015, 0.45, 0.68, 34);
  paperRiffle(result, 0.18, 16, 0.020, 0.74);
  paperSwipe(result, 0.61, 0.49, 0.57, 29);
  paperRiffle(result, 0.83, 14, 0.019, 0.64);
  paperSwipe(result, 1.19, 0.50, 0.67, 32);
  paperRiffle(result, 1.43, 17, 0.018, 0.72);
  paperSwipe(result, 1.86, 0.32, 0.46, 23);
  cardTap(result, 0.55, 0.55);
  cardTap(result, 1.13, 0.47);
  cardTap(result, 1.82, 0.50);
  cardTap(result, 2.19, 0.80);
  // Soft saturation keeps individual paper transients present without sharp spikes.
  for (let index = 0; index < result[0].length; index++)
    result[0][index] = Math.tanh(result[0][index] * 2.1);
  return normalize(result, 0.63);
}

function makeDeal() {
  const result = channels(0.38);
  paperSwipe(result, 0.006, 0.15, 1.1, 18);
  paperRiffle(result, 0.05, 3, 0.016, 0.38);
  cardTap(result, 0.14, 0.78);
  return normalize(result, 0.50);
}

function makeAmbient() {
  const result = channels(64, 2);
  // Eight slow bars: Dm9, Bbmaj7, Gm9, Am7, Dm9, Cadd9, Bbmaj7, Am7.
  // Notes overlap the next bar; circular event mixing preserves each reverb tail.
  const chords = [
    [50, 53, 57, 60, 64],
    [46, 53, 57, 62, 65],
    [43, 50, 53, 57, 58],
    [45, 52, 55, 60, 64],
    [50, 57, 60, 64, 65],
    [48, 55, 60, 62, 64],
    [46, 53, 57, 62, 65],
    [45, 52, 55, 60, 62],
  ];
  chords.forEach((chord, bar) => {
    chord.forEach((midi, voice) => {
      const hz = noteHz(midi);
      const phase = random() * tau;
      const pan = (voice - 2) * 0.16;
      addEvent(result, bar * 8, 12, (time) => {
        const envelope = smooth(time / 3.2) * smooth((12 - time) / 4.2);
        const motion = 0.92 + 0.08 * Math.sin(tau * time / 7 + phase);
        const leftPhase = tau * hz * time + phase;
        const rightPhase = tau * hz * 2 ** (1.6 / 1200) * time + phase;
        const timbre = (angle) => Math.sin(angle) + 0.12 * Math.sin(angle * 2) + 0.035 * Math.sin(angle * 3);
        const level = 0.026 * envelope * motion * (voice === 0 ? 0.85 : 1);
        return [timbre(leftPhase) * level * (1 - pan), timbre(rightPhase) * level * (1 + pan)];
      }, true);
    });
  });
  const melody = [
    [1.5, 69], [5.0, 64], [10.0, 65], [14.5, 62],
    [18.5, 67], [22.0, 65], [26.0, 64], [30.0, 60],
    [34.0, 69], [37.5, 72], [42.0, 67], [46.0, 64],
    [50.5, 65], [54.0, 62], [58.0, 64], [61.0, 62],
  ];
  melody.forEach(([start, midi], index) => {
    const hz = noteHz(midi);
    const pan = index % 2 ? 0.22 : -0.22;
    addEvent(result, start, 5.8, (time) => {
      const envelope = smooth(time / 0.035) * Math.exp(-time / 1.5) * smooth((5.8 - time) / 1.3);
      const bell = Math.sin(tau * hz * time)
        + 0.20 * Math.exp(-time / 0.6) * Math.sin(tau * hz * 2 * time)
        + 0.065 * Math.exp(-time / 0.3) * Math.sin(tau * hz * 3 * time);
      const level = bell * envelope * 0.052;
      return [level * (1 - pan), level * (1 + pan)];
    }, true);
  });
  // Dark, quiet cross-channel reflections; all delays wrap with the musical loop.
  const dry = result.map((channel) => channel.slice());
  const delays = [[0.23, 0.11], [0.41, 0.09], [0.73, 0.07], [1.13, 0.05], [1.67, 0.035]];
  for (let channel = 0; channel < 2; channel++) {
    for (const [seconds, gain] of delays) {
      const offset = Math.round(seconds * sampleRate);
      let filtered = dry[1 - channel][(dry[0].length - offset - 1) % dry[0].length];
      for (let frame = 0; frame < dry[0].length; frame++) {
        const source = dry[1 - channel][(frame - offset + dry[0].length) % dry[0].length];
        filtered += 0.18 * (source - filtered);
        result[channel][frame] += filtered * gain;
      }
    }
  }
  return normalize(result, 0.40);
}

function normalize(samples, peak) {
  let maximum = 0;
  for (const channel of samples)
    for (const sample of channel) {
      if (!Number.isFinite(sample)) throw new Error("Non-finite generated audio sample");
      maximum = Math.max(maximum, Math.abs(sample));
    }
  if (!maximum) throw new Error("Generated audio is silent");
  for (const channel of samples)
    for (let frame = 0; frame < channel.length; frame++)
      channel[frame] *= peak / maximum;
  return samples;
}

function encodeWav(samples) {
  const count = samples.length;
  const frames = samples[0].length;
  const bytes = Buffer.alloc(44 + frames * count * 2);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(count, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * count * 2, 28);
  bytes.writeUInt16LE(count * 2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(frames * count * 2, 40);
  let sum = 0;
  let peak = 0;
  let maxStep = 0;
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < count; channel++) {
      const sample = samples[channel][frame];
      if (!Number.isFinite(sample) || Math.abs(sample) >= 1) throw new Error("Invalid/clipping audio sample");
      const pcm = Math.round(sample * 32767);
      bytes.writeInt16LE(pcm, 44 + (frame * count + channel) * 2);
      sum += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
      if (frame) maxStep = Math.max(maxStep, Math.abs(sample - samples[channel][frame - 1]));
    }
  }
  const seamStep = Math.max(...samples.map((channel) => Math.abs(channel[0] - channel[frames - 1])));
  return {
    bytes,
    metadata: {
      seconds: frames / sampleRate,
      sampleRate,
      channels: count,
      bits: 16,
      bytes: bytes.length,
      peakDbFS: Number(db(peak).toFixed(2)),
      rmsDbFS: Number(db(Math.sqrt(sum / (frames * count))).toFixed(2)),
      seamStep: Number(seamStep.toFixed(6)),
      maxAdjacentStep: Number(maxStep.toFixed(6)),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
  };
}

await mkdir(output, { recursive: true });
const manifest = {
  title: "Tiệm Tarot original soundscape",
  provenance: "Original deterministic DSP composition; no external samples or recordings.",
  generator: "scripts/generate-audio-assets.mjs",
  assets: {},
};
for (const [filename, make] of [
  ["card-shuffle.wav", makeShuffle],
  ["card-deal.wav", makeDeal],
  ["tarot-ambient.wav", makeAmbient],
]) {
  const { bytes, metadata } = encodeWav(make());
  if (filename === "tarot-ambient.wav" && metadata.seamStep > metadata.maxAdjacentStep)
    throw new Error("Music seam is sharper than the waveform's internal transitions");
  await writeFile(new URL(filename, output), bytes);
  manifest.assets[filename] = metadata;
}
await writeFile(new URL("manifest.json", output), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ directory: fileURLToPath(output), ...manifest }, null, 2));
