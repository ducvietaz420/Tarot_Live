import type { Phase } from "../shared/types";
import { sentenceRanges } from "../shared/text";

export interface AudioSignature {
  readingId: string;
  phase: Phase;
  generation: number;
}
export interface PlaybackEnvironment {
  createUtterance(text: string): SpeechSynthesisUtterance;
  speak(utterance: SpeechSynthesisUtterance): void;
  cancelSpeech(): void;
  pauseSpeech(): void;
  resumeSpeech(): void;
  createAudio(url: string): HTMLAudioElement;
  requestAudio(
    signature: AudioSignature,
    signal: AbortSignal,
  ): Promise<{ url: string; text: string }>;
  every(callback: () => void, ms: number): ReturnType<typeof setInterval>;
  clearEvery(timer: ReturnType<typeof setInterval>): void;
  now?(): number;
}
export interface PlaybackOptions {
  signature: AudioSignature;
  text: string;
  provider: "browser" | "http";
  voice?: SpeechSynthesisVoice;
  rate: number;
  volume: number;
  startChar?: number;
  environment: PlaybackEnvironment;
  emit(message: Record<string, unknown>): void;
  status(message: string): void;
}
type State =
  | "idle"
  | "loading"
  | "playing"
  | "paused"
  | "ended"
  | "failed"
  | "disposed";

/** One utterance or file owns an entire card/summary. Display pages never start audio. */
export class ContinuousPlayback {
  state: State = "idle";
  charIndex = 0;
  signature: AudioSignature;
  private utterance: SpeechSynthesisUtterance | null = null;
  private audio: HTMLAudioElement | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private abort: AbortController | null = null;
  private requestVersion = 0;
  private baseOffset = 0;
  private restartOnResume = false;
  private loadingDeadline: number | null = null;
  private hasNativeBoundary = false;
  private resumeWatchdog: {
    deadline: number;
    cursor: number;
    restarted: boolean;
    requiresBoundary: boolean;
  } | null = null;
  private readonly env: PlaybackEnvironment;
  constructor(private readonly options: PlaybackOptions) {
    this.signature = { ...options.signature };
    this.env = options.environment;
    this.charIndex = this.sentenceStart(options.startChar || 0);
  }
  private message(type: string, fields: Record<string, unknown> = {}) {
    if (this.state !== "disposed")
      this.options.emit({ type, ...this.signature, ...fields });
  }
  private beginHold() {
    this.endHold();
    this.message("audio-start");
    this.heartbeat = this.env.every(() => this.pulse(), 1000);
  }
  private now() {
    return this.env.now?.() ?? Date.now();
  }
  private clearWatchdogs() {
    this.loadingDeadline = null;
    this.resumeWatchdog = null;
  }
  private detachSpeech() {
    const utterance = this.utterance;
    this.utterance = null;
    if (!utterance) return;
    utterance.onstart = null;
    utterance.onboundary = null;
    utterance.onend = null;
    utterance.onerror = null;
    utterance.onresume = null;
    utterance.onpause = null;
    this.env.cancelSpeech();
  }
  private pulse() {
    if (!["loading", "playing"].includes(this.state)) return;
    if (this.options.provider === "browser") {
      if (this.loadingDeadline !== null && this.now() >= this.loadingDeadline) {
        this.detachSpeech();
        this.fail("Giọng hệ thống không bắt đầu được · tiếp tục bằng chữ");
        return;
      }
      const probe = this.resumeWatchdog;
      if (probe && this.now() >= probe.deadline) {
        if (probe.restarted) {
          this.detachSpeech();
          this.fail("Giọng hệ thống không tiếp tục được · tiếp tục bằng chữ");
          return;
        }
        // A native resume may silently hang in Edge online voices. Retry once,
        // at a whole sentence boundary, without ever scheduling display chunks.
        this.detachSpeech();
        this.charIndex = this.sentenceStart(this.charIndex);
        this.state = "loading";
        this.resumeWatchdog = {
          deadline: this.now() + 10000,
          cursor: this.charIndex,
          restarted: true,
          requiresBoundary: probe.requiresBoundary,
        };
        this.options.status("Đang đọc tiếp từ đầu câu hiện tại");
        this.startSpeech();
      }
    }
    if (["loading", "playing"].includes(this.state))
      this.message("audio-heartbeat");
  }
  private endHold() {
    if (this.heartbeat !== null) {
      this.env.clearEvery(this.heartbeat);
      this.heartbeat = null;
    }
  }
  private sentenceStart(index: number) {
    const bounded = Math.max(0, Math.min(this.options.text.length - 1, index));
    return (
      sentenceRanges(this.options.text).find((range) => bounded < range.end)
        ?.start || 0
    );
  }
  private progress(index: number, timing: "boundary" | "estimated") {
    if (this.state !== "playing" && this.state !== "loading") return;
    this.charIndex = Math.max(
      0,
      Math.min(Math.max(0, this.options.text.length - 1), Math.floor(index)),
    );
    this.message("audio-progress", { charIndex: this.charIndex, timing });
  }
  private fail(message: string) {
    if (this.state === "disposed" || this.state === "ended") return;
    if (this.state === "paused") {
      this.restartOnResume = true;
      return;
    }
    this.state = "failed";
    this.clearWatchdogs();
    this.endHold();
    this.message("audio-error", { message });
    this.options.status(message);
  }
  private done() {
    if (
      this.state === "disposed" ||
      this.state === "failed" ||
      this.state === "ended"
    )
      return;
    if (this.state === "paused") {
      this.restartOnResume = true;
      return;
    }
    this.progress(
      this.options.text.length - 1,
      this.options.provider === "browser" ? "boundary" : "estimated",
    );
    this.state = "ended";
    this.clearWatchdogs();
    this.endHold();
    this.message("audio-done");
    this.options.status("Đã đọc trọn nội dung");
  }
  start() {
    if (this.state !== "idle") return;
    this.state = "loading";
    this.beginHold();
    if (this.options.provider === "http") void this.startHttp();
    else this.startSpeech();
  }
  private startSpeech() {
    if (!this.options.voice) {
      this.fail("Không có giọng Việt · tiếp tục bằng chữ");
      return;
    }
    this.baseOffset = this.sentenceStart(this.charIndex);
    this.loadingDeadline = this.now() + 10000;
    const utterance = this.env.createUtterance(
      this.options.text.slice(this.baseOffset),
    );
    this.utterance = utterance;
    utterance.voice = this.options.voice;
    utterance.lang = "vi-VN";
    utterance.rate = this.options.rate;
    utterance.volume = this.options.volume;
    let started = false;
    utterance.onstart = () => {
      if (this.state === "disposed" || this.utterance !== utterance) return;
      if (this.state === "paused") return;
      this.state = "playing";
      this.loadingDeadline = null;
      if (
        this.resumeWatchdog &&
        ((!this.resumeWatchdog.restarted && !started) ||
          (this.resumeWatchdog.restarted &&
            !this.resumeWatchdog.requiresBoundary))
      )
        this.resumeWatchdog = null;
      started = true;
      this.progress(Math.max(this.baseOffset, this.charIndex), "boundary");
      this.options.status("Đang đọc liền mạch · " + this.options.voice!.name);
    };
    utterance.onboundary = (event) => {
      if (this.utterance === utterance && this.state === "playing") {
        const absolute = this.baseOffset + event.charIndex;
        if (absolute > this.baseOffset) this.hasNativeBoundary = true;
        if (this.resumeWatchdog && absolute > this.resumeWatchdog.cursor)
          this.resumeWatchdog = null;
        this.progress(absolute, "boundary");
      }
    };
    utterance.onresume = (event) => {
      if (this.utterance !== utterance || this.state !== "playing") return;
      const absolute = this.baseOffset + event.charIndex;
      if (
        this.resumeWatchdog &&
        (!this.resumeWatchdog.requiresBoundary ||
          absolute > this.resumeWatchdog.cursor)
      )
        this.resumeWatchdog = null;
      if (absolute > this.charIndex) this.progress(absolute, "boundary");
    };
    utterance.onend = () => {
      if (this.utterance === utterance) this.done();
    };
    utterance.onerror = (event) => {
      if (this.utterance !== utterance || this.state === "disposed") return;
      if (this.state === "paused") {
        this.restartOnResume = true;
        return;
      }
      this.fail(`Giọng hệ thống lỗi (${event.error}) · tiếp tục bằng chữ`);
    };
    try {
      this.env.resumeSpeech();
      this.env.speak(utterance);
    } catch {
      this.fail("Không phát được giọng hệ thống · tiếp tục bằng chữ");
    }
  }
  private async startHttp() {
    const version = ++this.requestVersion;
    this.abort = new AbortController();
    try {
      const result = await this.env.requestAudio(
        { ...this.signature },
        this.abort.signal,
      );
      if (
        this.state === "disposed" ||
        this.state === "paused" ||
        version !== this.requestVersion
      )
        return;
      const audio = this.env.createAudio(result.url);
      this.audio = audio;
      audio.volume = this.options.volume;
      audio.onloadedmetadata = () => {
        if (this.state !== "disposed" && Number.isFinite(audio.duration))
          this.message("audio-duration", { seconds: audio.duration });
      };
      audio.onplay = () => {
        if (this.state === "disposed" || this.audio !== audio) return;
        if (this.state === "paused") return;
        this.state = "playing";
        this.progress(this.charIndex, "estimated");
        this.options.status("Đang đọc liền mạch qua TTS · phụ đề theo đoạn");
      };
      audio.ontimeupdate = () => {
        if (
          this.audio === audio &&
          Number.isFinite(audio.duration) &&
          audio.duration > 0
        )
          this.progress(
            (this.options.text.length * audio.currentTime) / audio.duration,
            "estimated",
          );
      };
      audio.onended = () => {
        if (this.audio === audio) this.done();
      };
      audio.onerror = () => {
        if (this.audio === audio)
          this.fail("TTS lỗi · tiếp tục bằng chữ và thời gian giữ");
      };
      await audio.play();
    } catch (error) {
      if (
        this.state !== "disposed" &&
        this.state !== "paused" &&
        version === this.requestVersion &&
        (error as Error).name !== "AbortError"
      )
        this.fail("TTS lỗi hoặc chưa cấu hình · tiếp tục bằng chữ");
    }
  }
  pause(signature: AudioSignature) {
    this.signature = { ...signature };
    if (!["loading", "playing"].includes(this.state)) return;
    this.state = "paused";
    this.clearWatchdogs();
    this.endHold();
    if (this.audio) this.audio.pause();
    if (this.utterance) {
      try {
        this.env.pauseSpeech();
      } catch {
        this.restartOnResume = true;
        this.env.cancelSpeech();
      }
    }
    if (this.abort && !this.audio) {
      this.requestVersion++;
      this.abort.abort();
      this.restartOnResume = true;
    }
  }
  resume(signature: AudioSignature) {
    this.signature = { ...signature };
    if (this.state !== "paused") return;
    this.state = "playing";
    this.beginHold();
    if (this.audio && !this.restartOnResume) {
      void this.audio
        .play()
        .catch(() => this.fail("Không tiếp tục được TTS · tiếp tục bằng chữ"));
    } else if (this.utterance && !this.restartOnResume) {
      try {
        this.resumeWatchdog = {
          deadline: this.now() + 2500,
          cursor: this.charIndex,
          restarted: false,
          requiresBoundary: this.hasNativeBoundary,
        };
        this.env.resumeSpeech();
        this.progress(this.charIndex, "boundary");
      } catch {
        this.restartOnResume = true;
      }
    } else this.restartOnResume = true;
    if (this.restartOnResume) {
      this.restartOnResume = false;
      if (this.utterance) {
        this.detachSpeech();
      }
      this.state = "loading";
      if (this.options.provider === "http") void this.startHttp();
      else {
        this.charIndex = this.sentenceStart(this.charIndex);
        this.resumeWatchdog = {
          deadline: this.now() + 10000,
          cursor: this.charIndex,
          restarted: true,
          requiresBoundary: this.hasNativeBoundary,
        };
        this.startSpeech();
      }
    }
  }
  dispose() {
    if (this.state === "disposed") return;
    const shouldCancelSpeech =
      this.utterance && !["ended", "failed"].includes(this.state);
    this.state = "disposed";
    this.clearWatchdogs();
    this.endHold();
    this.requestVersion++;
    this.abort?.abort();
    if (shouldCancelSpeech) this.detachSpeech();
    else this.utterance = null;
    if (this.audio) {
      this.audio.pause();
      this.audio.src = "";
      this.audio = null;
    }
  }
}
