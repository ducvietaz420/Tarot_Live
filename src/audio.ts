import { useEffect, useRef, useState, type RefObject } from "react";
import type { Snapshot } from "../shared/types";
import { ContinuousPlayback, type AudioSignature } from "./speech-playback";

export function currentSpeech(state: Snapshot): string {
  const reading = state.session.active;
  if (!reading) return "";
  const index = ["card1", "card2", "card3"].indexOf(reading.phase);
  return index >= 0
    ? reading.content.cards[index]?.speech || ""
    : reading.phase === "summary"
      ? reading.content.summary
      : "";
}

/** An explicit, server-granted audio lease is required before this hook speaks. */
export function useAudio(
  state: Snapshot | null,
  socket: RefObject<WebSocket | null>,
  clientId: string,
) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [status, setStatus] = useState("Chưa bật âm thanh");
  const [requesting, setRequesting] = useState(false);
  const playback = useRef<ContinuousPlayback | null>(null);
  const playbackKey = useRef("");
  const playbackReplay = useRef(0);
  const pausedSnapshot = useRef("");
  const savedCursor = useRef({ key: "", charIndex: 0 });
  const testUtterance = useRef<SpeechSynthesisUtterance | null>(null);
  const waitingForVoice = useRef(false);
  const context = useRef<AudioContext | null>(null);
  const ambient = useRef<{
    gain: GainNode;
    oscillators: OscillatorNode[];
  } | null>(null);
  const pendingTest = useRef(false);

  const previousSfx = useRef("");
  const send = (message: object) => {
    if (socket.current?.readyState === WebSocket.OPEN)
      socket.current.send(JSON.stringify(message));
    else if (
      (message as { type?: string }).type === "audio-heartbeat" &&
      playback.current
    ) {
      stop();
      setStatus("Mất kết nối máy chủ · đã dừng âm thanh");
    }
  };
  const report = (message: string) => {
    setStatus(message);
    send({ type: "audio-status", status: message });
  };
  const stop = () => {
    if (playback.current) {
      savedCursor.current = {
        key: playbackKey.current,
        charIndex: playback.current.charIndex,
      };
      playback.current.dispose();
      playback.current = null;
    }
    if (testUtterance.current && "speechSynthesis" in window) {
      testUtterance.current = null;
      speechSynthesis.cancel();
    }
  };
  const getContext = () => {
    if (!context.current || context.current.state === "closed")
      context.current = new AudioContext();
    return context.current;
  };
  useEffect(() => {
    const supported = "speechSynthesis" in window;
    const load = () => {
      if (supported) setVoices(speechSynthesis.getVoices());
    };
    if (supported) {
      load();
      speechSynthesis.addEventListener("voiceschanged", load);
    } else setStatus("Trình duyệt không có giọng hệ thống");
    return () => {
      if (supported) speechSynthesis.removeEventListener("voiceschanged", load);
      stop();
      ambient.current?.oscillators.forEach((o) => o.stop());
      ambient.current = null;
      void context.current?.close();
      context.current = null;
    };
  }, []);
  const vi = voices.filter((v) => v.lang.toLowerCase().startsWith("vi"));
  const owner = state?.audioOwner === clientId;
  const busy = !!state?.audioOwnerMode && state.audioOwnerMode !== state.mode;
  const enable = async () => {
    if (busy) {
      setStatus(
        `Nguồn âm thanh đang ở phiên ${state!.audioOwnerMode!.toUpperCase()}. Tắt tại tab đó trước.`,
      );
      return;
    }
    setRequesting(true);
    try {
      await getContext().resume();
      send({ type: "audio-claim" });
    } catch {
      report("Không mở được thiết bị âm thanh của trình duyệt");
    }
    setTimeout(() => setRequesting(false), 1000);
  };
  const disable = () => {
    pendingTest.current = false;
    stop();
    send({ type: "audio-release" });
    setStatus("Đã tắt âm thanh ở tab này");
  };
  const testVoice = () => {
    if (!state) return;
    if (state.session.active && !state.session.active.paused) {
      report("Tạm dừng lượt hiện tại trước khi kiểm tra giọng");
      return;
    }
    if (!owner) {
      pendingTest.current = true;
      void enable();
      return;
    }
    const voice =
      voices.find(
        (v) =>
          v.voiceURI === state.config.voice &&
          v.lang.toLowerCase().startsWith("vi"),
      ) || vi[0];
    if (!voice) {
      report("Không tìm thấy giọng Việt. Chọn TTS HTTP hoặc chạy bằng chữ.");
      return;
    }
    stop();
    const utterance = new SpeechSynthesisUtterance(
      "Chào bạn, chào mừng đến với Tiệm Tarot. Chúc bạn một buổi tối an lành.",
    );
    testUtterance.current = utterance;
    utterance.voice = voice;
    utterance.lang = "vi-VN";
    utterance.rate = state.config.speechRate;
    utterance.volume = state.config.speechVolume;
    utterance.onend = () => {
      if (testUtterance.current !== utterance) return;
      testUtterance.current = null;
      report("Thử giọng thành công · " + voice.name);
    };
    utterance.onerror = () => {
      if (testUtterance.current !== utterance) return;
      testUtterance.current = null;
      report("Thử giọng bị lỗi hoặc bị trình duyệt chặn");
    };
    speechSynthesis.resume();
    speechSynthesis.speak(utterance);
    report("Đang thử giọng · " + voice.name);
  };
  const reading = state?.session.active;
  const token = reading
    ? `${state?.mode}:${reading.id}:${reading.phase}:${reading.generation}:${reading.paused}:${owner}`
    : `idle:${owner}`;
  const reconcile = () => {
    const text = state ? currentSpeech(state) : "";
    const key =
      state && reading ? `${state.mode}:${reading.id}:${reading.phase}` : "";
    if (
      !state ||
      !reading ||
      !owner ||
      !text ||
      reading.config.ttsProvider === "off"
    ) {
      stop();
      playbackKey.current = "";
      pausedSnapshot.current = "";
      waitingForVoice.current = false;
      return;
    }
    if (socket.current?.readyState !== WebSocket.OPEN) {
      stop();
      return;
    }
    const signature: AudioSignature = {
      readingId: reading.id,
      phase: reading.phase,
      generation: reading.generation || 0,
    };
    const existing = playback.current;
    if (existing && playbackKey.current === key) {
      if ((reading.replayCount || 0) !== playbackReplay.current) {
        stop();
        savedCursor.current = { key, charIndex: 0 };
        pausedSnapshot.current = "";
      } else {
        if (reading.paused) {
          pausedSnapshot.current = key;
          existing.pause(signature);
          return;
        }
        if (pausedSnapshot.current === key) {
          pausedSnapshot.current = "";
          if (existing.state === "paused") existing.resume(signature);
          else existing.signature = { ...signature };
          return;
        }
        if (existing.signature.generation === signature.generation) return;
        // A generation change without pause is explicit replay, not a voice/page update.
        stop();
        savedCursor.current = { key, charIndex: 0 };
      }
    } else if (existing) {
      stop();
      savedCursor.current = { key, charIndex: 0 };
    }
    if (reading.paused) return;
    if (testUtterance.current && "speechSynthesis" in window) {
      testUtterance.current = null;
      speechSynthesis.cancel();
    }
    const voice =
      voices.find(
        (v) =>
          v.voiceURI === reading.config.voice &&
          v.lang.toLowerCase().startsWith("vi"),
      ) || vi[0];
    waitingForVoice.current =
      reading.config.ttsProvider === "browser" && !voice;
    const player = new ContinuousPlayback({
      signature,
      text,
      provider: reading.config.ttsProvider,
      voice,
      rate: reading.config.speechRate,
      volume: reading.config.speechVolume,
      startChar:
        savedCursor.current.key === key ? savedCursor.current.charIndex : 0,
      environment: {
        createUtterance: (value) => new SpeechSynthesisUtterance(value),
        speak: (utterance) => speechSynthesis.speak(utterance),
        cancelSpeech: () => speechSynthesis.cancel(),
        pauseSpeech: () => speechSynthesis.pause(),
        resumeSpeech: () => speechSynthesis.resume(),
        createAudio: (url) => new Audio(url),
        requestAudio: async (signature, signal) => {
          const response = await fetch(`/api/tts?mode=${state.mode}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Audio-Client": clientId,
            },
            body: JSON.stringify(signature),
            signal,
          });
          if (!response.ok)
            throw new Error("TTS chưa cấu hình hoặc chưa sẵn sàng");
          return response.json();
        },
        every: (callback, ms) => setInterval(callback, ms),
        clearEvery: (timer) => clearInterval(timer),
      },
      emit: send,
      status: report,
    });
    playback.current = player;
    playbackKey.current = key;
    playbackReplay.current = reading.replayCount || 0;
    pausedSnapshot.current = "";
    player.start();
  };
  useEffect(() => {
    reconcile();
  }, [token]);
  // Catalog updates may rescue a missing voice; they never restart working speech.
  useEffect(() => {
    if (waitingForVoice.current && vi.length > 0) {
      stop();
      waitingForVoice.current = false;
      reconcile();
    }
  }, [voices]);
  useEffect(() => {
    if (owner && pendingTest.current) {
      pendingTest.current = false;
      testVoice();
    }
  }, [owner]);

  useEffect(() => {
    if (!state || !owner) return;
    if (state.config.music && !ambient.current) {
      const ctx = getContext();
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      const oscillators = [110, 164.81, 220].map((frequency) => {
        const oscillator = ctx.createOscillator();
        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        oscillator.connect(gain);
        oscillator.start();
        return oscillator;
      });
      ambient.current = { gain, oscillators };
    }
    if (ambient.current && context.current)
      ambient.current.gain.gain.setTargetAtTime(
        state.config.music
          ? state.config.musicVolume *
              (reading && !reading.paused && currentSpeech(state) ? 0.035 : 0.1)
          : 0,
        context.current.currentTime,
        0.4,
      );
  }, [owner, token, state?.config.music, state?.config.musicVolume]);
  useEffect(() => {
    if (!owner && ambient.current && context.current)
      ambient.current.gain.gain.setTargetAtTime(
        0,
        context.current.currentTime,
        0.1,
      );
  }, [owner]);
  useEffect(() => {
    const sfxKey = reading
      ? `${reading.id}:${reading.phase}:${reading.replayCount || 0}`
      : "";
    if (
      !owner ||
      !reading ||
      reading.paused ||
      !reading.config.sfx ||
      previousSfx.current === sfxKey
    )
      return;
    previousSfx.current = sfxKey;
    if (
      !["shuffling", "dealing", "card1", "card2", "card3"].includes(
        reading.phase,
      )
    )
      return;
    const ctx = getContext();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(
      reading.phase === "shuffling" ? 240 : 660,
      ctx.currentTime,
    );
    oscillator.frequency.exponentialRampToValueAtTime(
      180,
      ctx.currentTime + 0.18,
    );
    gain.gain.setValueAtTime(
      0.025 * reading.config.speechVolume,
      ctx.currentTime,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.2);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.2);
  }, [token]);
  return {
    voices,
    vi,
    owner,
    enable,
    disable,
    test: testVoice,
    requesting,
    busy,
    status: owner
      ? status
      : busy
        ? `Nguồn âm thanh đang ở phiên ${state!.audioOwnerMode!.toUpperCase()}. Tắt tại tab đó trước.`
        : state?.audioOwner
          ? `Tab khác đang giữ âm thanh · ${state.audioStatus || ""}`
          : state?.audioStatus?.startsWith("DEMO:")
            ? state.audioStatus
            : status,
  };
}
