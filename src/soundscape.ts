export type SceneSound = "shuffle" | "deal" | "music";

const ASSETS: Record<SceneSound, string> = {
  shuffle: "/assets/audio/card-shuffle.wav",
  deal: "/assets/audio/card-deal.wav",
  music: "/assets/audio/tarot-ambient.wav",
};

interface Voice {
  source: AudioBufferSourceNode;
  gain: GainNode;
  finish: (completed: boolean) => void;
}

const level = (value: number) =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

/** Local audio shares the same browser context and ownership as narration. */
export class TarotSoundscape {
  private buffers = new Map<SceneSound, Promise<AudioBuffer>>();
  private music: Voice | null = null;
  private effect: Voice | null = null;
  private musicGeneration = 0;
  private effectGeneration = 0;
  private disposed = false;

  constructor(
    private readonly context: AudioContext,
    private readonly load: (url: string) => Promise<AudioBuffer> = async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error("Không tải được âm thanh local");
      return context.decodeAudioData(await response.arrayBuffer());
    },
  ) {}

  private buffer(sound: SceneSound) {
    let task = this.buffers.get(sound);
    if (!task) {
      task = this.load(ASSETS[sound]).catch((error: unknown) => {
        this.buffers.delete(sound);
        throw error;
      });
      this.buffers.set(sound, task);
    }
    return task;
  }

  async preload() {
    await Promise.all([this.buffer("shuffle"), this.buffer("deal"), this.buffer("music")]);
  }

  private voice(buffer: AudioBuffer, done: (completed: boolean) => void): Voice {
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = buffer;
    source.connect(gain).connect(this.context.destination);
    let finished = false;
    const voice: Voice = {
      source,
      gain,
      finish: (completed) => {
        if (finished) return;
        finished = true;
        source.onended = null;
        source.disconnect();
        gain.disconnect();
        done(completed);
      },
    };
    source.onended = () => voice.finish(true);
    return voice;
  }

  private silence(voice: Voice | null) {
    if (!voice) return;
    voice.gain.gain.cancelScheduledValues(this.context.currentTime);
    voice.gain.gain.setValueAtTime(0, this.context.currentTime);
    try { voice.source.stop(); } catch { /* already ended */ }
    voice.finish(false);
  }

  async setMusic(enabled: boolean, volume: number, ducked: boolean) {
    const generation = ++this.musicGeneration;
    const target = level(volume) * (ducked ? 0.4 : 1);
    if (this.disposed || !enabled || target === 0) {
      this.silence(this.music);
      this.music = null;
      return;
    }
    if (this.music) {
      this.music.gain.gain.setTargetAtTime(target, this.context.currentTime, 0.35);
      return;
    }
    const buffer = await this.buffer("music");
    if (this.disposed || generation !== this.musicGeneration) return;
    const voice = this.voice(buffer, () => {
      if (this.music === voice) this.music = null;
    });
    this.music = voice;
    voice.source.loop = true;
    voice.gain.gain.setValueAtTime(0, this.context.currentTime);
    voice.gain.gain.setTargetAtTime(target, this.context.currentTime, 0.6);
    voice.source.start();
  }

  stopMusic() {
    this.musicGeneration++;
    this.silence(this.music);
    this.music = null;
  }

  async playEffect(sound: SceneSound, volume: number, seconds?: number): Promise<boolean> {
    this.stopEffects();
    const generation = this.effectGeneration;
    const target = level(volume);
    if (this.disposed || target === 0) return false;
    const buffer = await this.buffer(sound);
    if (this.disposed || generation !== this.effectGeneration) return false;
    const duration = seconds === undefined ? buffer.duration : Math.max(0, seconds);
    if (!Number.isFinite(duration) || duration === 0) return false;
    return new Promise((resolve) => {
      const voice = this.voice(buffer, (completed) => {
        if (this.effect === voice) this.effect = null;
        resolve(completed);
      });
      this.effect = voice;
      voice.source.loop = duration > buffer.duration;
      voice.gain.gain.setValueAtTime(target, this.context.currentTime);
      voice.source.start();
      voice.source.stop(this.context.currentTime + duration);
    });
  }

  setEffectVolume(volume: number) {
    this.effect?.gain.gain.setTargetAtTime(level(volume), this.context.currentTime, 0.03);
  }

  stopEffects() {
    this.effectGeneration++;
    this.silence(this.effect);
    this.effect = null;
  }

  dispose() {
    this.disposed = true;
    this.stopMusic();
    this.stopEffects();
    this.buffers.clear();
  }
}
