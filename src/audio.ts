import { useEffect, useRef, useState, type RefObject } from "react";
import type { Snapshot } from "../shared/types";
import { ContinuousPlayback, type AudioSignature } from "./speech-playback";
import { TarotSoundscape } from "./soundscape";

export function currentSpeech(state: Snapshot): string {
  const reading = state.session.active;
  if (!reading) return "";
  if (reading.phase === "answer")
    return reading.followUp?.questions.find((item) =>
      item.id === reading.followUp?.currentQuestionId && item.status === "answered"
    )?.answer || "";
  const index = ["card1", "card2", "card3"].indexOf(reading.phase);
  return index >= 0
    ? reading.content.cards[index]?.speech || ""
    : reading.phase === "summary"
      ? reading.content.summary
      : "";
}

export function speechPlaybackKey(state: Snapshot): string {
  const reading = state.session.active;
  if (!reading) return "";
  const question = reading.phase === "answer" ? `:${reading.followUp?.currentQuestionId || ""}` : "";
  return `${state.mode}:${reading.id}:${reading.phase}${question}`;
}

/** An explicit, server-granted audio lease is required before this hook speaks. */
export function useAudio(
  state: Snapshot | null,
  socket: RefObject<WebSocket | null>,
  clientId: string,
  online: boolean,
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
  const testTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waitingForVoice = useRef(false);
  const context = useRef<AudioContext | null>(null);
  const soundscape = useRef<TarotSoundscape | null>(null);
  const [soundPreview, changeSoundPreview] = useState(false);
  const soundPreviewActive = useRef(false);
  const setSoundPreview = (active: boolean) => {
    soundPreviewActive.current = active;
    changeSoundPreview(active);
  };
  const soundPreviewGeneration = useRef(0);
  const musicUpdateGeneration = useRef(0);
  const pendingSoundTest = useRef<"shuffle" | "music" | null>(null);
  const pendingTest = useRef(false);
  const temporaryTestOwner = useRef(false);
  const claimGeneration = useRef(0);

  const previousSfx = useRef("");
  const send = (message: object) => {
    if (socket.current?.readyState === WebSocket.OPEN) {
      socket.current.send(JSON.stringify(message));
      return true;
    } else if (
      (message as { type?: string }).type === "audio-heartbeat" &&
      playback.current
    ) {
      stop();
      setStatus("Mất kết nối máy chủ · đã dừng âm thanh");
    }
    return false;
  };
  const report = (message: string) => {
    setStatus(message);
    send({ type: "audio-status", status: message });
  };
  const stop = () => {
    soundPreviewGeneration.current++;
    soundscape.current?.stopEffects();
    setSoundPreview(false);
    if (testTimeout.current) clearTimeout(testTimeout.current);
    testTimeout.current = null;
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
  const getSoundscape = () => {
    if (!soundscape.current)
      soundscape.current = new TarotSoundscape(getContext());
    return soundscape.current;
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
      soundscape.current?.dispose();
      soundscape.current = null;
      void context.current?.close();
      context.current = null;
    };
  }, []);
  const vi = voices.filter((v) => v.lang.toLowerCase().startsWith("vi"));
  const owner = online && state?.audioOwner === clientId;
  const ownsAudio = useRef(false);
  ownsAudio.current = owner;
  const busy = !!state?.audioOwnerMode && state.audioOwnerMode !== state.mode;
  const claim = async (transfer: boolean) => {
    const generation = ++claimGeneration.current;
    if (busy) {
      setStatus(
        `Nguồn âm thanh đang ở phiên ${state!.audioOwnerMode!.toUpperCase()}. Tắt tại tab đó trước.`,
      );
      return false;
    }
    if (socket.current?.readyState !== WebSocket.OPEN) {
      setStatus("Chờ kết nối máy chủ trước khi bật âm thanh");
      return false;
    }
    setRequesting(true);
    try {
      await getContext().resume();
      if (generation !== claimGeneration.current) return false;
      void getSoundscape().preload().catch(() => {
        if (ownsAudio.current) report("Không tải được nhạc/hiệu ứng. Hãy tải lại overlay.");
      });
      return send({ type: "audio-claim", transfer });
    } catch {
      report("Không mở được thiết bị âm thanh của trình duyệt");
      return false;
    } finally {
      setTimeout(() => {
        setRequesting(false);
        if (!ownsAudio.current) {
          pendingTest.current = false;
          pendingSoundTest.current = null;
          temporaryTestOwner.current = false;
        }
      }, 1000);
    }
  };
  const enable = () => claim(false);
  const transfer = () => claim(true);
  const releaseTestOwner = () => {
    pendingTest.current = false;
    pendingSoundTest.current = null;
    if (temporaryTestOwner.current) {
      claimGeneration.current++;
      if (!ownsAudio.current) temporaryTestOwner.current = false;
      send({ type: "audio-release" });
    }
  };
  const disable = () => {
    pendingTest.current = false;
    pendingSoundTest.current = null;
    claimGeneration.current++;
    temporaryTestOwner.current = false;
    stop();
    send({ type: "audio-release" });
    setStatus("Đã tắt âm thanh ở tab này");
  };
  const testVoice = () => {
    if (!state) return;
    if (state.session.active && !state.session.active.paused) {
      report("Tạm dừng lượt hiện tại trước khi kiểm tra giọng");
      releaseTestOwner();
      return;
    }
    if (!owner) {
      if (busy || state.audioOwner) {
        setStatus(
          "Âm thanh đang ở tab khác. Kiểm tra giọng tại nguồn đang phát hoặc tắt nguồn đó trước.",
        );
        return;
      }
      pendingTest.current = true;
      temporaryTestOwner.current = true;
      void claim(false).then((sent) => {
        if (!sent) releaseTestOwner();
      });
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
      releaseTestOwner();
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
    const finish = (message: string) => {
      if (testUtterance.current !== utterance) return;
      testUtterance.current = null;
      if (testTimeout.current) clearTimeout(testTimeout.current);
      testTimeout.current = null;
      report(message);
      releaseTestOwner();
    };
    utterance.onend = () => finish("Thử giọng thành công · " + voice.name);
    utterance.onerror = () => {
      finish("Thử giọng bị lỗi hoặc bị trình duyệt chặn");
    };
    testTimeout.current = setTimeout(() => {
      if (testUtterance.current !== utterance) return;
      finish(
        "Thử giọng quá thời gian chờ. Hãy kiểm tra lại giọng của trình duyệt.",
      );
      speechSynthesis.cancel();
    }, 30000);
    try {
      speechSynthesis.resume();
      speechSynthesis.speak(utterance);
      report("Đang thử giọng · " + voice.name);
    } catch {
      finish("Không phát được giọng thử của trình duyệt");
    }
  };
  const testSound = (kind: "shuffle" | "music") => {
    if (!state) return;
    if (state.session.active && !state.session.active.paused) {
      report("Tạm dừng lượt hiện tại trước khi nghe thử âm thanh");
      releaseTestOwner();
      return;
    }
    if (!owner) {
      if (busy || state.audioOwner) {
        setStatus("Âm thanh đang ở tab khác. Tắt nguồn đó trước khi nghe thử tại admin.");
        return;
      }
      pendingSoundTest.current = kind;
      temporaryTestOwner.current = true;
      void claim(false).then((sent) => {
        if (!sent) releaseTestOwner();
      });
      return;
    }
    stop();
    const volume = kind === "shuffle" ? state.config.sfxVolume ?? 0.65 : state.config.musicVolume;
    if (volume <= 0) {
      report("Âm lượng đang bằng 0. Tăng âm lượng rồi nghe thử lại.");
      releaseTestOwner();
      return;
    }
    const generation = soundPreviewGeneration.current;
    const scene = getSoundscape();
    scene.stopMusic();
    setSoundPreview(true);
    report(kind === "shuffle" ? "Đang nghe thử tiếng xào bài" : "Đang nghe thử nhạc nền tarot · 12 giây");
    const finish = (message: string) => {
      if (generation !== soundPreviewGeneration.current || !ownsAudio.current) return;
      setSoundPreview(false);
      report(message);
      releaseTestOwner();
    };
    void scene.playEffect(kind, volume, kind === "music" ? 12 : undefined)
      .then((completed) => {
        finish(completed
          ? kind === "shuffle" ? "Đã phát thử tiếng xào bài" : "Đã phát thử nhạc nền tarot"
          : "Đã dừng nghe thử âm thanh");
      })
      .catch(() => finish("Không tải được âm thanh local. Hãy tải lại overlay."));
  };
  const reading = state?.session.active;
  const token = reading
    ? `${state?.mode}:${reading.id}:${reading.phase}:${reading.generation}:${reading.paused}:${owner}`
    : `idle:${owner}`;
  const reconcile = () => {
    const text = state ? currentSpeech(state) : "";
    const key = state ? speechPlaybackKey(state) : "";
    if (reading && !reading.paused && (temporaryTestOwner.current || soundPreviewActive.current)) {
      stop();
      if (temporaryTestOwner.current) {
        releaseTestOwner();
        return;
      }
    }
    if (
      !state ||
      !reading ||
      !owner ||
      temporaryTestOwner.current ||
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
    if (owner && pendingSoundTest.current) {
      const kind = pendingSoundTest.current;
      pendingSoundTest.current = null;
      testSound(kind);
    } else if (owner && pendingTest.current) {
      pendingTest.current = false;
      pendingSoundTest.current = null;
      testVoice();
    } else if (!owner) {
      pendingTest.current = false;
      pendingSoundTest.current = null;
      temporaryTestOwner.current = false;
    }
  }, [owner]);

  useEffect(() => {
    const generation = ++musicUpdateGeneration.current;
    if (!state || !owner || temporaryTestOwner.current || soundPreview) {
      soundscape.current?.stopMusic();
      return;
    }
    const ducked = !!reading && !reading.paused && !!currentSpeech(state) && reading.config.ttsProvider !== "off";
    void getSoundscape().setMusic(state.config.music, state.config.musicVolume, ducked)
      .then(() => {
        if (generation !== musicUpdateGeneration.current || !ownsAudio.current) return;
        if (!reading || reading.paused)
          report(state.config.music && state.config.musicVolume > 0
            ? "Đang phát nhạc nền tarot"
            : "Nguồn âm thanh đã sẵn sàng");
      })
      .catch(() => {
        if (ownsAudio.current) report("Không tải được nhạc nền tarot. Hãy tải lại overlay.");
      });
  }, [owner, token, soundPreview, state?.config.music, state?.config.musicVolume]);
  useEffect(() => {
    const sfxKey = reading
      ? `${reading.id}:${reading.phase}:${reading.generation}:${reading.replayCount || 0}`
      : "";
    if (soundPreviewActive.current && owner) return;
    if (
      !owner ||
      temporaryTestOwner.current ||
      !reading ||
      reading.paused ||
      !state?.config.sfx ||
      soundPreview
    ) {
      soundscape.current?.stopEffects();
      previousSfx.current = "";
      return;
    }
    const volume = state.config.sfxVolume ?? 0.65;
    if (volume <= 0) {
      soundscape.current?.stopEffects();
      previousSfx.current = "";
      return;
    }
    if (previousSfx.current === sfxKey) {
      soundscape.current?.setEffectVolume(volume * (reading.phase === "shuffling" ? 1 : 0.55));
      return;
    }
    previousSfx.current = sfxKey;
    soundscape.current?.stopEffects();
    if (
      !["shuffling", "dealing", "card1", "card2", "card3"].includes(
        reading.phase,
      )
    )
      return;
    const shuffle = reading.phase === "shuffling";
    const remaining = Math.max(0.1, (reading.phaseDuration - (state.serverTime - reading.phaseStartedAt)) / 1000);
    void getSoundscape().playEffect(shuffle ? "shuffle" : "deal", volume * (shuffle ? 1 : 0.55), shuffle ? remaining : undefined)
      .catch(() => {
        if (ownsAudio.current) report("Không tải được tiếng xào/lật bài. Hãy tải lại overlay.");
      });
  }, [token, soundPreview, state?.config.sfx, state?.config.sfxVolume]);
  return {
    voices,
    vi,
    owner,
    enable,
    transfer,
    disable,
    test: testVoice,
    testShuffle: () => testSound("shuffle"),
    testMusic: () => testSound("music"),
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
