import { randomInt, randomUUID } from "node:crypto";
import { CARDS } from "../shared/cards.ts";
import {
  TOPICS,
  type Action,
  type AudioSegment,
  type Config,
  type Connection,
  type Credit,
  type Mode,
  type NormalizedEvent,
  type Phase,
  type QueueItem,
  type Reading,
  type Session,
  type Snapshot,
  type Topic,
} from "../shared/types.ts";
import {
  aiAvailable,
  fallback,
  generateAI,
  phaseText,
  ttsAvailable,
  words,
} from "./providers.ts";
import { Store } from "./store.ts";
import { normalizeEnvelope } from "./tikfinity.ts";
import { sentenceRanges } from "../shared/text.ts";

const AUDIO_INITIAL_GRACE_MS = 10_000;
const AUDIO_HEARTBEAT_GRACE_MS = 6_000;
const AUDIO_HARD_LIMIT_MS = 180_000;
const AUDIO_END_TAIL_MS = 800;
interface AudioLease {
  readingId: string;
  phase: Phase;
  generation: number;
  ownerId: string;
  expiresAt: number;
  hardDeadline: number;
}

export const DEFAULT_CONFIG: Config = {
  shopName: "TIỆM TAROT",
  instruction: "Bình luận {command} chủ đề | câu hỏi",
  footer: "Một câu hỏi, ba lá bài, một khoảng lặng cho chính bạn.",
  accent: "#ef9ad5",
  cyan: "#71d9df",
  fontScale: 1,
  safeTop: 50,
  safeBottom: 75,
  safeX: 44,
  reducedMotion: false,
  fps: 30,
  characterAsset: "/assets/tarot-reader.png",
  backgroundAsset: "",
  cardBackAsset: "/assets/card-back.svg",
  cardAssets: {},
  joinMode: "gift_question",
  minCoins: 1,
  giftValues: {},
  command: "!tarot",
  matchWindowSec: 300,
  cooldownSec: 15,
  maxQuestionLength: 220,
  priority: false,
  maxWaitSec: 600,
  moderation: false,
  accepting: true,
  autoRun: false,
  reversed: true,
  heartGoal: 3000,
  communityCooldownSec: 90,
  maxCommunityPending: 1,
  durations: {
    locking: 2,
    shuffling: 3,
    dealing: 2,
    card: 24,
    summary: 20,
    complete: 6,
  },
  aiEnabled: false,
  aiModel: "",
  aiTimeoutSec: 18,
  displayWords: 65,
  summaryWords: 50,
  ttsProvider: "browser",
  voice: "",
  speechRate: 0.95,
  speechVolume: 0.85,
  music: false,
  musicVolume: 0.12,
  sfx: true,
};
export function blankSession(): Session {
  return {
    queue: [],
    active: null,
    credits: [],
    hearts: { total: 0, milestones: 0, consumed: 0 },
    logs: [],
    seen: {},
    combos: {},
  };
}
const unresolved = (q: QueueItem) =>
  ["waiting_question", "waiting_condition", "ready"].includes(q.status);
const isRecord = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);
function safeAsset(x: unknown) {
  return typeof x === "string" &&
    x.length <= 1000 &&
    !x.includes("..") &&
    (x === "" ||
      /^\/(?:assets|custom)\/[\w\-./% ]+$/u.test(x) ||
      /^https?:\/\/[^\s<>]+$/u.test(x))
    ? x
    : undefined;
}
export function validateConfig(input: unknown, previous: Config): Config {
  if (!isRecord(input)) throw new Error("Cấu hình phải là một object.");
  const out = structuredClone(previous);
  const strings: Record<string, number> = {
    shopName: 70,
    instruction: 220,
    footer: 180,
    command: 20,
    voice: 200,
    aiModel: 150,
  };
  for (const [key, max] of Object.entries(strings))
    if (key in input) {
      if (typeof input[key] !== "string" || input[key].length > max)
        throw new Error(`Giá trị ${key} không hợp lệ.`);
      (out as unknown as Record<string, unknown>)[key] = input[key];
    }
  if (!/^!\S{1,18}$/u.test(out.command))
    throw new Error("Lệnh phải bắt đầu bằng ! và không có khoảng trắng.");
  const bools = [
    "reducedMotion",
    "priority",
    "moderation",
    "accepting",
    "autoRun",
    "reversed",
    "aiEnabled",
    "music",
    "sfx",
  ] as const;
  for (const key of bools)
    if (key in input) {
      if (typeof input[key] !== "boolean")
        throw new Error(`${key} phải là boolean.`);
      out[key] = input[key];
    }
  const nums: Record<string, [number, number]> = {
    fontScale: [0.9, 1.15],
    safeTop: [0, 80],
    safeBottom: [0, 100],
    safeX: [20, 80],
    minCoins: [1, 100000],
    matchWindowSec: [10, 86400],
    cooldownSec: [0, 86400],
    maxQuestionLength: [30, 500],
    maxWaitSec: [30, 86400],
    heartGoal: [1, 10000000],
    communityCooldownSec: [0, 3600],
    maxCommunityPending: [1, 5],
    aiTimeoutSec: [2, 60],
    displayWords: [45, 70],
    summaryWords: [35, 55],
    speechRate: [0.5, 1.5],
    speechVolume: [0, 1],
    musicVolume: [0, 0.5],
  };
  for (const [key, [min, max]] of Object.entries(nums))
    if (key in input) {
      const value = input[key];
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < min ||
        value > max
      )
        throw new Error(`${key}: cần từ ${min} đến ${max}.`);
      (out as unknown as Record<string, unknown>)[key] = value;
    }
  for (const key of ["accent", "cyan"] as const)
    if (key in input) {
      if (typeof input[key] !== "string" || !/^#[\da-f]{6}$/iu.test(input[key]))
        throw new Error("Màu cần định dạng #RRGGBB.");
      out[key] = input[key];
    }
  if ("fps" in input) {
    if (![30, 60].includes(Number(input.fps)))
      throw new Error("FPS cần là 30 hoặc 60.");
    out.fps = Number(input.fps);
  }
  if ("joinMode" in input) {
    if (
      !["free", "gift_question", "gift_priority"].includes(
        String(input.joinMode),
      )
    )
      throw new Error("Chế độ tham gia không hợp lệ.");
    out.joinMode = input.joinMode as Config["joinMode"];
  }
  if ("ttsProvider" in input) {
    if (!["browser", "http", "off"].includes(String(input.ttsProvider)))
      throw new Error("TTS provider không hợp lệ.");
    out.ttsProvider = input.ttsProvider as Config["ttsProvider"];
  }
  for (const key of [
    "characterAsset",
    "backgroundAsset",
    "cardBackAsset",
  ] as const)
    if (key in input) {
      const value = safeAsset(input[key]);
      if (value === undefined)
        throw new Error("Asset phải là đường dẫn /assets/ hoặc URL http(s).");
      out[key] = value;
    }
  if ("cardAssets" in input) {
    if (
      !isRecord(input.cardAssets) ||
      Object.keys(input.cardAssets).length > 78
    )
      throw new Error("Bảng hình lá bài không hợp lệ.");
    const assets: Record<string, string> = {};
    for (const [key, value] of Object.entries(input.cardAssets)) {
      const valid = safeAsset(value);
      if (!CARDS.some((c) => c.id === key) || valid === undefined)
        throw new Error("ID hoặc hình lá bài không hợp lệ.");
      assets[key] = valid;
    }
    out.cardAssets = assets;
  }
  if ("giftValues" in input) {
    if (
      !isRecord(input.giftValues) ||
      Object.keys(input.giftValues).length > 1000
    )
      throw new Error("Bảng giá trị quà không hợp lệ.");
    const values: Record<string, number> = {};
    for (const [key, value] of Object.entries(input.giftValues)) {
      if (
        !/^[\w-]{1,80}$/u.test(key) ||
        typeof value !== "number" ||
        !Number.isSafeInteger(value) ||
        value < 0 ||
        value > 1e6
      )
        throw new Error("Giá trị quà phải là số xu nguyên không âm.");
      values[key] = value;
    }
    out.giftValues = values;
  }
  if ("durations" in input) {
    if (!isRecord(input.durations)) throw new Error("Thời lượng không hợp lệ.");
    for (const key of Object.keys(
      out.durations,
    ) as (keyof Config["durations"])[]) {
      if (key in input.durations) {
        const v = input.durations[key];
        if (typeof v !== "number" || !Number.isFinite(v) || v < 0.2 || v > 180)
          throw new Error("Mỗi bước cần 0.2–180 giây.");
        out.durations[key] = v;
      }
    }
  }
  return out;
}
export function parseQuestion(
  comment: string,
  config: Config,
): { topic: Topic; question: string } | undefined {
  const text = comment.trim().replace(/\s+/gu, " ");
  if (
    text.length > config.maxQuestionLength + 60 ||
    /(?:https?:\/\/|www\.)/iu.test(text)
  )
    return;
  const command = text
    .toLocaleLowerCase("vi")
    .startsWith(config.command.toLocaleLowerCase("vi") + " ");
  const raw = command ? text.slice(config.command.length).trim() : text;
  const lower = raw.toLocaleLowerCase("vi");
  const topic = TOPICS.find((t) => lower.startsWith(t.toLocaleLowerCase("vi")));
  let question: string;
  if (topic) {
    question = raw
      .slice(topic.length)
      .replace(/^\s*[|:–-]?\s*/u, "")
      .trim();
  } else if (
    command ||
    /(?:cho (?:em|mình|tôi|con) (?:xem|rút)|xem (?:bài|tarot)|rút (?:bài|tarot))/iu.test(
      raw,
    )
  ) {
    question = raw;
  } else return;
  if (
    question.length < 8 ||
    question.length > config.maxQuestionLength ||
    !/[\p{L}]/u.test(question)
  )
    return;
  if (/(.)\1{8,}/u.test(question)) return;
  return { topic: topic || "Công việc", question };
}

export class Engine {
  config: Config;
  sessions: Record<Mode, Session>;
  connection: Connection = {
    status: "disconnected",
    url: "ws://localhost:21213/",
    attempts: 0,
  };
  audioOwners: Record<Mode, string | null> = { demo: null, live: null };
  audioStatuses: Record<Mode, string> = {
    demo: "Chưa bật âm thanh trên overlay.",
    live: "Chưa bật âm thanh trên overlay.",
  };
  private audioSegments: Partial<Record<Mode, AudioSegment>> = {};
  private audioLeases: Partial<Record<Mode, AudioLease>> = {};
  onChange: (mode?: Mode) => void = () => {};
  onReconnect: () => void = () => {};
  private controllers: Partial<Record<Mode, AbortController>> = {};
  private aiPending: Partial<
    Record<
      Mode,
      {
        readingId: string;
        generation: number;
        deadline: number;
        signal: AbortSignal;
      }
    >
  > = {};
  private now: () => number;
  private rng: (max: number) => number;
  private store: Store;
  private restartHold = new Set<Mode>();
  constructor(
    store = new Store(":memory:"),
    options: { now?: () => number; rng?: (max: number) => number } = {},
  ) {
    this.store = store;
    this.now = options.now || Date.now;
    this.rng = options.rng || randomInt;
    const saved = store.load();
    this.config = saved
      ? validateConfig(saved.config, DEFAULT_CONFIG)
      : structuredClone(DEFAULT_CONFIG);
    this.sessions = saved?.sessions || {
      demo: blankSession(),
      live: blankSession(),
    };
    for (const session of Object.values(this.sessions))
      session.hearts.consumed ??=
        session.hearts.milestones * this.config.heartGoal;
    for (const mode of ["demo", "live"] as Mode[]) {
      const a = this.sessions[mode].active;
      if (a || this.sessions[mode].queue.some(unresolved))
        this.restartHold.add(mode);
      if (a) {
        a.remainingMs = Math.max(
          500,
          a.paused
            ? a.remainingMs || a.phaseDuration
            : a.phaseDuration - (this.now() - a.phaseStartedAt),
        );
        a.paused = true;
        a.generation = (a.generation || 0) + 1;
        this.log(
          mode,
          "recovery",
          "paused",
          "Đã khôi phục lượt đang dở, chờ quản trị tiếp tục.",
        );
      } else if (this.restartHold.has(mode))
        this.log(
          mode,
          "recovery",
          "paused",
          "Đã khôi phục hàng chờ; hãy bấm bắt đầu trước khi tự động chạy tiếp.",
        );
    }
    this.save();
  }
  private save() {
    this.store.save({ config: this.config, sessions: this.sessions });
  }
  private changed(mode?: Mode) {
    this.save();
    this.onChange(mode);
  }
  private log(mode: Mode, event: string, status: string, detail: string) {
    const s = this.sessions[mode];
    s.logs.unshift({
      id: randomUUID(),
      at: this.now(),
      source: mode,
      event,
      status,
      detail: detail.slice(0, 500),
    });
    s.logs = s.logs.slice(0, 100);
  }
  snapshot(mode: Mode): Snapshot {
    const active = this.sessions[mode].active;
    const seg = this.audioSegments[mode];
    const audioSegment =
      active &&
      !active.paused &&
      seg?.readingId === active.id &&
      seg.phase === active.phase &&
      seg.generation === active.generation
        ? seg
        : undefined;
    const snapshot: Snapshot = structuredClone({
      mode,
      config: this.config,
      session: { ...this.sessions[mode], seen: {}, combos: {} },
      connection: this.connection,
      audioOwner: this.audioOwners[mode],
      audioOwnerMode: (["demo", "live"] as Mode[]).find(
        (m) => !!this.audioOwners[m],
      ),
      serverTime: this.now(),
      capabilities: { ai: aiAvailable(), tts: ttsAvailable() },
      audioStatus: this.audioStatuses[mode],
      audioSegment,
      audioActive:
        !!active && !active.paused && this.audioHolding(mode, active),
    });
    snapshot.session.queue.sort((a, b) => {
      const ar = unresolved(a),
        br = unresolved(b);
      if (ar !== br) return ar ? -1 : 1;
      return ar ? this.compareQueue(a, b) : a.createdAt - b.createdAt;
    });
    return snapshot;
  }
  setConnection(connection: Connection) {
    this.connection = { ...connection };
    this.onChange();
  }
  setAudioOwner(mode: Mode, id: string | null) {
    if (
      id &&
      Object.values(this.audioOwners).some((owner) => owner && owner !== id)
    )
      return false;
    if (id && this.audioOwners[mode] && this.audioOwners[mode] !== id)
      return false;
    if (this.audioOwners[mode] !== id) {
      delete this.audioLeases[mode];
      delete this.audioSegments[mode];
    }
    this.audioOwners[mode] = id;
    this.onChange();
    return true;
  }
  setAudioStatus(mode: Mode, status: string) {
    this.audioStatuses[mode] = status.slice(0, 250);
    this.onChange(mode);
  }
  setAudioSegment(mode: Mode, input: Record<string, unknown>) {
    const a = this.sessions[mode].active;
    if (
      !a ||
      a.paused ||
      a.id !== input.readingId ||
      a.phase !== input.phase ||
      a.generation !== input.generation ||
      typeof input.text !== "string" ||
      input.text.length < 1 ||
      input.text.length > 700 ||
      typeof input.index !== "number" ||
      !Number.isInteger(input.index) ||
      input.index < 0 ||
      input.index > 10 ||
      !this.currentText(mode).includes(input.text)
    )
      return;
    this.audioSegments[mode] = {
      readingId: a.id,
      phase: a.phase,
      generation: a.generation!,
      text: input.text,
      index: input.index,
    };
    this.onChange(mode);
  }
  audioProgress(mode: Mode, input: Record<string, unknown>) {
    const a = this.matchAudioReading(
      mode,
      input.readingId,
      input.phase,
      input.generation,
    );
    if (
      !a ||
      !this.audioOwners[mode] ||
      typeof input.charIndex !== "number" ||
      !Number.isInteger(input.charIndex) ||
      !["boundary", "estimated"].includes(String(input.timing))
    )
      return;
    const text = this.currentText(mode);
    if (input.charIndex < 0 || input.charIndex > text.length) return;
    const ranges = sentenceRanges(text);
    if (!ranges.length) return;
    const charIndex = Math.min(input.charIndex, Math.max(0, text.length - 1));
    const found = ranges.findIndex((range) => charIndex < range.end);
    const index = found < 0 ? ranges.length - 1 : found;
    this.audioSegments[mode] = {
      readingId: a.id,
      phase: a.phase,
      generation: a.generation || 0,
      text: ranges[index].text,
      index,
      charIndex,
      timing: input.timing as "boundary" | "estimated",
    };
    this.onChange(mode);
  }
  private matchAudioReading(
    mode: Mode,
    readingId: unknown,
    phase: unknown,
    generation: unknown,
  ) {
    const a = this.sessions[mode].active;
    return a &&
      !a.paused &&
      a.id === readingId &&
      a.phase === phase &&
      a.generation === generation &&
      this.currentText(mode)
      ? a
      : undefined;
  }
  audioStart(
    mode: Mode,
    readingId: unknown,
    phase: unknown,
    generation: unknown,
  ) {
    const a = this.matchAudioReading(mode, readingId, phase, generation),
      ownerId = this.audioOwners[mode];
    if (!a || !ownerId || a.config.ttsProvider === "off") return;
    const hardDeadline = a.phaseStartedAt + AUDIO_HARD_LIMIT_MS;
    if (this.now() >= hardDeadline) return;
    const existing = this.audioLeases[mode];
    if (
      existing &&
      existing.readingId === a.id &&
      existing.phase === a.phase &&
      existing.generation === a.generation &&
      existing.ownerId === ownerId
    ) {
      existing.expiresAt = Math.min(
        hardDeadline,
        this.now() + AUDIO_INITIAL_GRACE_MS,
      );
    } else {
      this.audioLeases[mode] = {
        readingId: a.id,
        phase: a.phase,
        generation: a.generation || 0,
        ownerId,
        expiresAt: Math.min(hardDeadline, this.now() + AUDIO_INITIAL_GRACE_MS),
        hardDeadline,
      };
    }
    this.audioStatuses[mode] = "Đang chuẩn bị hoặc phát toàn bộ lời đọc.";
    this.onChange(mode);
  }
  audioHeartbeat(
    mode: Mode,
    readingId: unknown,
    phase: unknown,
    generation: unknown,
  ) {
    const a = this.matchAudioReading(mode, readingId, phase, generation),
      lease = this.audioLeases[mode];
    if (
      !a ||
      !lease ||
      lease.readingId !== a.id ||
      lease.phase !== a.phase ||
      lease.generation !== a.generation ||
      lease.ownerId !== this.audioOwners[mode] ||
      this.now() >= lease.hardDeadline
    )
      return;
    lease.expiresAt = Math.min(
      lease.hardDeadline,
      this.now() + AUDIO_HEARTBEAT_GRACE_MS,
    );
  }
  audioError(
    mode: Mode,
    readingId: unknown,
    phase: unknown,
    generation: unknown,
  ) {
    const a = this.matchAudioReading(mode, readingId, phase, generation);
    if (!a || !this.audioOwners[mode]) return;
    delete this.audioLeases[mode];
    delete this.audioSegments[mode];
    this.audioStatuses[mode] =
      "Âm thanh không khả dụng; tiếp tục bằng chữ và thời gian giữ nội dung.";
    this.onChange(mode);
  }
  private audioHolding(mode: Mode, a: Reading) {
    const lease = this.audioLeases[mode];
    if (!lease) return false;
    if (
      lease.readingId !== a.id ||
      lease.phase !== a.phase ||
      lease.generation !== a.generation ||
      lease.ownerId !== this.audioOwners[mode] ||
      a.paused
    ) {
      delete this.audioLeases[mode];
      return false;
    }
    if (this.now() >= lease.expiresAt || this.now() >= lease.hardDeadline) {
      delete this.audioLeases[mode];
      delete this.audioSegments[mode];
      this.audioStatuses[mode] =
        "Không còn tín hiệu phát âm thanh; tiếp tục theo thời gian hiển thị.";
      return false;
    }
    return true;
  }
  signal(mode: Mode) {
    return this.controllers[mode]?.signal || AbortSignal.abort();
  }
  private resetController(mode: Mode) {
    this.controllers[mode]?.abort();
    this.controllers[mode] = new AbortController();
    return this.controllers[mode]!.signal;
  }
  private updateRoom(mode: Mode, event: NormalizedEvent) {
    if (!event.roomId) return;
    const s = this.sessions[mode];
    if (s.roomId && s.roomId !== event.roomId) {
      s.hearts = { total: 0, milestones: 0, consumed: 0, roomId: event.roomId };
      for (const q of s.queue)
        if (q.community && unresolved(q)) q.status = "skipped";
      for (const c of s.credits)
        if (!c.usedBy && c.roomId && c.roomId !== event.roomId)
          c.review =
            "Credit thuộc phòng trước; admin cần đối soát và ghép thủ công.";
      this.log(
        mode,
        "room",
        "changed",
        "Đổi room: đã đặt lại baseline tim và hủy lượt chung chưa chạy; credit và lịch sử cá nhân được giữ để đối soát.",
      );
    }
    s.roomId = event.roomId;
  }
  ingest(event: NormalizedEvent, mode: Mode = "live") {
    const s = this.sessions[mode];
    const now = this.now();
    this.updateRoom(mode, event);
    let key = event.id
      ? `${event.roomId || s.roomId || "session"}:${event.type}:${event.id}`
      : undefined;
    if (event.type === "gift" && event.giftType === 1 && key)
      key += `:${event.repeatCount ?? "?"}:${event.repeatEnd === true ? "final" : "progress"}`;
    if (key && s.seen[key] !== undefined) {
      this.log(
        mode,
        event.type,
        "duplicate",
        "Đã nhận trước đó; không áp dụng lại.",
      );
      this.changed(mode);
      return;
    }
    if (key) s.seen[key] = now;
    if (event.issues.length)
      this.log(mode, event.type, "review", event.issues.join("; "));
    if (event.type === "chat") this.chat(event, mode);
    else if (event.type === "gift") this.gift(event, mode);
    else if (event.type === "like") this.like(event, mode);
    else if (["follow", "share", "subscribe"].includes(event.type)) {
      s.notice = {
        text: `Cảm ơn ${event.user?.name || "bạn"} đã ${event.type === "follow" ? "theo dõi" : event.type === "share" ? "chia sẻ LIVE" : "đăng ký"} ♡`,
        at: now,
      };
      this.log(
        mode,
        event.type,
        "received",
        "Hiệu ứng cảm ơn; không tạo lượt tarot.",
      );
    } else
      this.log(
        mode,
        event.type,
        event.type === "invalid" ? "invalid" : "received",
        event.type === "roomUser"
          ? "Chỉ ghi nhận snapshot số người xem, không tạo người hoặc lượt."
          : "Sự kiện không tạo lượt tarot.",
      );
    this.maybeCommunity(mode);
    this.maybeStart(mode);
    this.changed(mode);
  }
  private chat(event: NormalizedEvent, mode: Mode) {
    const s = this.sessions[mode];
    const now = this.now();
    if (!event.user) {
      this.log(
        mode,
        "chat",
        "review",
        "Thiếu ID tài khoản ổn định; không ghép bằng nickname.",
      );
      return;
    }
    const parsed = parseQuestion(event.comment || "", this.config);
    if (!parsed) {
      this.log(
        mode,
        "chat",
        "ignored",
        "Không phải câu hỏi tarot hợp lệ, quá dài hoặc bị lọc spam.",
      );
      return;
    }
    if (!this.config.accepting) {
      this.log(mode, "chat", "closed", "Đang đóng nhận lượt.");
      return;
    }
    if (s.active?.user.id === event.user.id) {
      this.log(
        mode,
        "chat",
        "locked",
        "Người này đang đọc; câu hỏi đã khóa. Quà mới vẫn được lưu riêng.",
      );
      return;
    }
    let q = s.queue.find((q) => q.user.id === event.user!.id && unresolved(q));
    if (q && q.question === parsed.question && q.topic === parsed.topic) {
      this.log(mode, "chat", "ignored", "Câu hỏi không thay đổi.");
      return;
    }
    if (q?.question && now - q.updatedAt < 1000) {
      this.log(mode, "chat", "spam", "Giới hạn cập nhật một câu hỏi mỗi giây.");
      return;
    }
    if (!q) {
      const previous = s.queue
        .filter(
          (q) =>
            q.user.id === event.user!.id &&
            ["completed", "skipped"].includes(q.status),
        )
        .sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (
        previous &&
        now - previous.updatedAt < this.config.cooldownSec * 1000
      ) {
        this.log(
          mode,
          "chat",
          "cooldown",
          "Chưa hết thời gian nghỉ giữa hai lượt.",
        );
        return;
      }
      q = {
        id: randomUUID(),
        user: event.user,
        topic: parsed.topic,
        question: parsed.question,
        status: "waiting_condition",
        createdAt: now,
        updatedAt: now,
        coins: 0,
        creditIds: [],
        order: now,
        approved: !this.config.moderation,
      };
      s.queue.push(q);
    } else {
      if (!q.question)
        for (const c of s.credits)
          if (
            c.usedBy === q.id &&
            now - c.at > this.config.matchWindowSec * 1000
          ) {
            c.usedBy = undefined;
            c.review =
              "Quà quá cửa sổ ghép tự động; admin có thể xác nhận và ghép thủ công.";
            q.creditIds = q.creditIds.filter((id) => id !== c.id);
            q.coins -= c.coins || 0;
          }
      q.user = event.user;
      q.topic = parsed.topic;
      q.question = parsed.question;
      q.updatedAt = now;
    }
    this.matchCredits(q, mode);
    this.qualify(q);
    this.log(
      mode,
      "chat",
      q.status,
      `Đã ghi câu hỏi của ${event.user.name} (${event.user.id}).`,
    );
  }
  private qualify(q: QueueItem) {
    if (!q.question) q.status = "waiting_question";
    else if (
      (this.config.joinMode === "gift_question" &&
        q.coins < this.config.minCoins) ||
      (this.config.moderation && !q.approved)
    )
      q.status = "waiting_condition";
    else q.status = "ready";
  }
  private matchCredits(q: QueueItem, mode: Mode, includeOld = false) {
    const s = this.sessions[mode];
    const now = this.now();
    for (const c of s.credits) {
      if (
        c.userId !== q.user.id ||
        c.usedBy ||
        c.review ||
        c.coins === null ||
        (!includeOld && now - c.at > this.config.matchWindowSec * 1000)
      )
        continue;
      c.usedBy = q.id;
      q.creditIds.push(c.id);
      q.coins += c.coins;
    }
  }
  private gift(event: NormalizedEvent, mode: Mode) {
    const s = this.sessions[mode];
    const now = this.now();
    if (!event.user || !event.giftId) {
      this.log(
        mode,
        "gift",
        "review",
        "Thiếu ID người hoặc loại quà; giữ cảnh báo, không gán credit cho người đoán.",
      );
      return;
    }
    if (
      event.repeatCount === undefined ||
      !Number.isSafeInteger(event.repeatCount) ||
      event.repeatCount < 1 ||
      event.giftType === undefined
    ) {
      this.addCredit(
        event,
        mode,
        0,
        "Thiếu repeatCount/giftType đã xác minh; cần đối soát.",
      );
      return;
    }
    let count = event.repeatCount;
    if (event.giftType === 1) {
      const comboKey = event.comboId
        ? `${event.roomId || s.roomId || "session"}:${event.user.id}:${event.giftId}:${event.comboId}`
        : undefined;
      const prev = comboKey ? s.combos[comboKey] : undefined;
      if (prev?.finalized) {
        this.log(
          mode,
          "gift",
          "duplicate",
          "Combo đã chốt, không cấp lại credit.",
        );
        return;
      }
      if (comboKey)
        s.combos[comboKey] = {
          count: Math.max(prev?.count || 0, count),
          finalized: false,
        };
      if (event.repeatEnd !== true) {
        this.log(
          mode,
          "gift",
          "combo_progress",
          `Combo đang tăng: ${count}; chưa cấp quyền lợi.`,
        );
        return;
      }
      count = Math.max(prev?.count || 0, count);
      if (comboKey) s.combos[comboKey] = { count, finalized: true };
      if (!comboKey && !event.id) {
        this.addCredit(
          event,
          mode,
          count,
          "Combo thiếu cả groupId và event ID; không tự áp dụng để tránh tính trùng.",
        );
        return;
      }
      if (!comboKey)
        this.log(
          mode,
          "gift",
          "limited",
          "Thiếu định danh combo; chỉ chống lặp bằng ID của sự kiện kết thúc, cần so payload LIVE.",
        );
    } else if (!event.id) {
      this.addCredit(
        event,
        mode,
        count,
        "Quà không combo thiếu event ID; không thể chống phát lại đáng tin cậy.",
      );
      return;
    }
    this.addCredit(event, mode, count);
  }
  private addCredit(
    event: NormalizedEvent,
    mode: Mode,
    count: number,
    review?: string,
  ) {
    const s = this.sessions[mode];
    const now = this.now();
    const unit = event.coins ?? this.config.giftValues[event.giftId!];
    const coins = unit === undefined ? null : unit * count;
    if (coins !== null && (!Number.isSafeInteger(coins) || coins > 1e12))
      review = "Giá trị/count vượt giới hạn, cần đối soát.";
    const credit: Credit = {
      id: randomUUID(),
      userId: event.user!.id,
      coins,
      count,
      giftId: event.giftId!,
      giftName: event.giftName || `Quà ${event.giftId}`,
      at: now,
      review:
        review ||
        (unit === undefined
          ? "Chưa biết giá trị xu; bổ sung bảng quy đổi rồi xác nhận."
          : undefined),
      roomId: event.roomId,
    };
    s.credits.push(credit);
    if (!credit.review && s.active?.user.id !== event.user!.id) {
      let q = s.queue.find(
        (q) => q.user.id === event.user!.id && unresolved(q),
      );
      if (!q && this.config.accepting) {
        q = {
          id: randomUUID(),
          user: event.user!,
          topic: "Tình duyên",
          question: "",
          status: "waiting_question",
          createdAt: now,
          updatedAt: now,
          coins: 0,
          creditIds: [],
          order: now,
          approved: !this.config.moderation,
        };
        s.queue.push(q);
      }
      if (
        q &&
        (!q.question || now - q.updatedAt <= this.config.matchWindowSec * 1000)
      ) {
        this.matchCredits(q, mode);
        this.qualify(q);
      }
    }
    this.log(
      mode,
      "gift",
      credit.review
        ? "credit_review"
        : s.active?.user.id === event.user!.id
          ? "credit_next"
          : "credited",
      credit.review ||
        `Đã lưu ${count} × ${unit} = ${coins} xu cho ID ${event.user!.id}; chưa dùng lại cho lượt khác.`,
    );
  }
  private like(event: NormalizedEvent, mode: Mode) {
    const s = this.sessions[mode],
      h = s.hearts;
    let delta = 0;
    if (event.likeCount !== undefined && event.id) {
      delta = event.likeCount;
      if (event.totalLikeCount !== undefined) {
        h.baseline ??= Math.max(0, event.totalLikeCount - delta);
        h.cumulative = event.totalLikeCount;
      }
    } else if (event.totalLikeCount !== undefined) {
      if (h.cumulative === undefined) {
        h.baseline = event.totalLikeCount;
        h.cumulative = event.totalLikeCount;
      } else if (event.totalLikeCount >= h.cumulative) {
        delta = event.totalLikeCount - h.cumulative;
        h.cumulative = event.totalLikeCount;
      } else {
        this.log(
          mode,
          "like",
          "out_of_order",
          "Tổng tim thấp hơn mốc đã nhận trong cùng phòng; bỏ qua frame cũ. Nếu bộ đếm thật sự reset, admin cần mở phiên mới.",
        );
      }
    } else {
      this.log(
        mode,
        "like",
        "review",
        "Tim tăng thêm thiếu event ID và không có tổng tích lũy; không tự cộng.",
      );
      return;
    }
    if (Number.isSafeInteger(delta) && delta >= 0 && delta <= 1e9) {
      h.total += delta;
      this.log(
        mode,
        "like",
        "counted",
        `+${delta} tim; tổng phiên ${h.total}.`,
      );
    }
  }
  private maybeCommunity(mode: Mode) {
    const s = this.sessions[mode],
      h = s.hearts,
      now = this.now();
    const pending = s.queue.filter(
      (q) => q.community && (unresolved(q) || q.status === "reading"),
    ).length;
    const consumed = h.consumed ?? 0;
    if (
      h.total - consumed < this.config.heartGoal ||
      pending >= this.config.maxCommunityPending ||
      (h.lastCommunityAt !== undefined &&
        now - h.lastCommunityAt < this.config.communityCooldownSec * 1000)
    )
      return;
    h.milestones++;
    h.consumed = consumed + this.config.heartGoal;
    h.lastCommunityAt = now;
    s.queue.push({
      id: randomUUID(),
      user: {
        id: `community:${h.milestones}`,
        name: "Cả phòng LIVE",
        avatar: "/assets/avatars/community.svg",
      },
      topic: "Công việc",
      question:
        "Thông điệp nào giúp cả phòng hướng đến những điều tích cực hôm nay?",
      status: "ready",
      createdAt: now,
      updatedAt: now,
      coins: 0,
      creditIds: [],
      community: true,
      approved: true,
      order: now,
    });
    this.log(
      mode,
      "hearts",
      "milestone",
      `Mốc ${h.milestones} đã mở đúng một lượt chung. Phần dư được giữ.`,
    );
  }
  private next(mode: Mode) {
    return this.sessions[mode].queue
      .filter((q) => q.status === "ready")
      .sort((a, b) => this.compareQueue(a, b))[0];
  }
  private compareQueue(a: QueueItem, b: QueueItem) {
    if (a.status !== b.status) {
      if (a.status === "ready") return -1;
      if (b.status === "ready") return 1;
    }
    if (a.community !== b.community) return a.community ? -1 : 1;
    const now = this.now();
    const agedA = now - a.createdAt >= this.config.maxWaitSec * 1000,
      agedB = now - b.createdAt >= this.config.maxWaitSec * 1000;
    if (agedA !== agedB) return agedA ? -1 : 1;
    if (
      !agedA &&
      (this.config.priority || this.config.joinMode === "gift_priority") &&
      a.coins !== b.coins
    )
      return b.coins - a.coins;
    return (
      (a.order ?? a.createdAt) - (b.order ?? b.createdAt) ||
      a.createdAt - b.createdAt
    );
  }
  private maybeStart(mode: Mode) {
    if (
      this.config.autoRun &&
      !this.restartHold.has(mode) &&
      !this.sessions[mode].active
    )
      this.start(mode);
  }
  start(mode: Mode, id?: string) {
    this.restartHold.delete(mode);
    const s = this.sessions[mode];
    if (s.active) return;
    const q = id
      ? s.queue.find((q) => q.id === id && q.status === "ready")
      : this.next(mode);
    if (!q) return;
    const pool = [...CARDS];
    const cards = Array.from({ length: 3 }, (_, position) => {
      const c = pool.splice(this.rng(pool.length), 1)[0];
      return {
        cardId: c.id,
        position,
        reversed: this.config.reversed && this.rng(2) === 1,
      };
    });
    const reading: Reading = {
      id: randomUUID(),
      itemId: q.id,
      user: structuredClone(q.user),
      topic: q.topic,
      question: q.question,
      cards,
      content: null as unknown as Reading["content"],
      phase: "locking",
      paused: false,
      phaseStartedAt: this.now(),
      phaseDuration: this.config.durations.locking * 1000,
      createdAt: this.now(),
      config: structuredClone(this.config),
      community: q.community,
      generation: 1,
      replayCount: 0,
    };
    reading.content = fallback(reading);
    q.status = "reading";
    q.readingId = reading.id;
    s.active = reading;
    const signal = this.resetController(mode);
    this.log(
      mode,
      "reading",
      "started",
      `Đã khóa câu hỏi và 3 lá cho readingId ${reading.id}.`,
    );
    this.changed(mode);
    if (reading.config.aiEnabled) void this.enrich(reading, mode, signal);
  }
  private async enrich(reading: Reading, mode: Mode, signal: AbortSignal) {
    const job = {
      readingId: reading.id,
      generation: reading.generation || 0,
      deadline: this.now() + reading.config.aiTimeoutSec * 1000,
      signal,
    };
    this.aiPending[mode] = job;
    try {
      const content = await generateAI(reading, signal);
      const current = this.sessions[mode].active;
      if (
        !signal.aborted &&
        current?.id === reading.id &&
        current.generation === job.generation &&
        ["locking", "shuffling", "dealing"].includes(current.phase)
      ) {
        current.content = content;
        this.log(
          mode,
          "ai",
          "success",
          "Lời giải đã xác thực đúng 3 lá cố định.",
        );
        this.changed(mode);
      }
    } catch {
      if (
        !signal.aborted &&
        this.sessions[mode].active?.id === reading.id &&
        this.sessions[mode].active?.generation === job.generation
      ) {
        reading.content.error =
          "AI chưa cấu hình, timeout hoặc phản hồi không hợp lệ; dùng nội dung biên soạn đúng các lá đã chốt.";
        this.log(mode, "ai", "fallback", reading.content.error);
        this.changed(mode);
      }
    } finally {
      // A canceled older request must not clear a newer reading's pending job.
      if (this.aiPending[mode] === job) delete this.aiPending[mode];
    }
  }
  private duration(a: Reading, phase: Phase) {
    if (phase.startsWith("card") || phase === "summary") {
      const cfg =
        phase === "summary"
          ? a.config.durations.summary
          : a.config.durations.card;
      const text =
        phase === "summary"
          ? a.content.summary
          : a.content.cards[Number(phase.slice(-1)) - 1].speech;
      return Math.max(
        cfg * 1000,
        (words(text) / (2.9 * a.config.speechRate) + 3) * 1000,
      );
    }
    if (phase === "idle") return 0;
    return (
      a.config.durations[
        phase as "locking" | "shuffling" | "dealing" | "complete"
      ] * 1000
    );
  }
  advance(mode: Mode) {
    const s = this.sessions[mode],
      a = s.active;
    if (!a || a.paused) return;
    const pending = this.aiPending[mode];
    if (
      a.phase === "dealing" &&
      pending?.readingId === a.id &&
      pending.generation === a.generation &&
      !pending.signal.aborted
    ) {
      if (this.now() < pending.deadline) return;
      // Bound the wait even if a provider fails to settle after cancellation.
      // Audio on the next phase receives a new, live AbortSignal.
      this.resetController(mode);
      delete this.aiPending[mode];
      a.content.error =
        "AI timeout; dùng nội dung biên soạn đúng các lá đã chốt.";
      this.log(mode, "ai", "fallback", a.content.error);
    }
    const phases: Phase[] = [
      "locking",
      "shuffling",
      "dealing",
      "card1",
      "card2",
      "card3",
      "summary",
      "complete",
    ];
    const next = phases[phases.indexOf(a.phase) + 1];
    if (!next) {
      const q = s.queue.find((q) => q.id === a.itemId);
      if (q) {
        q.status = "completed";
        q.updatedAt = this.now();
      }
      this.controllers[mode]?.abort();
      s.active = null;
      this.log(mode, "reading", "completed", `Đã hoàn tất ${a.id}.`);
      this.maybeCommunity(mode);
      this.maybeStart(mode);
      this.changed(mode);
      return;
    }
    delete this.audioLeases[mode];
    delete this.audioSegments[mode];
    a.phase = next;
    a.phaseStartedAt = this.now();
    a.phaseDuration = this.duration(a, next);
    a.remainingMs = undefined;
    this.changed(mode);
  }
  tick() {
    for (const mode of ["demo", "live"] as Mode[]) {
      const a = this.sessions[mode].active;
      if (
        a &&
        !a.paused &&
        this.now() - a.phaseStartedAt >= a.phaseDuration &&
        !this.audioHolding(mode, a)
      )
        this.advance(mode);
      if (!a) {
        const old = this.sessions[mode].queue.length;
        this.maybeCommunity(mode);
        if (this.sessions[mode].queue.length !== old) this.changed(mode);
        this.maybeStart(mode);
      }
    }
  }
  action(action: Action, mode: Mode): Snapshot {
    const s = this.sessions[mode],
      a = s.active;
    const now = this.now();
    const id = typeof action.id === "string" ? action.id : undefined;
    switch (action.type) {
      case "config":
        this.config = validateConfig(action.config, this.config);
        for (const m of ["demo", "live"] as Mode[])
          for (const q of this.sessions[m].queue)
            if (unresolved(q)) this.qualify(q);
        break;
      case "start":
        this.start(mode, id);
        break;
      case "pause":
        if (a && !a.paused) {
          a.remainingMs = Math.max(
            0,
            a.phaseDuration - (now - a.phaseStartedAt),
          );
          a.paused = true;
          a.generation = (a.generation || 0) + 1;
          this.controllers[mode]?.abort();
          delete this.audioLeases[mode];
        }
        break;
      case "resume":
        this.restartHold.delete(mode);
        if (a && a.paused) {
          a.paused = false;
          a.phaseStartedAt = now;
          a.phaseDuration = Math.max(
            1000,
            a.remainingMs || this.duration(a, a.phase),
          );
          a.remainingMs = undefined;
          a.generation = (a.generation || 0) + 1;
          this.resetController(mode);
          delete this.audioLeases[mode];
        }
        break;
      case "skip":
        if (a) {
          const q = s.queue.find((q) => q.id === a.itemId);
          if (q) {
            q.status = "skipped";
            q.updatedAt = now;
          }
          this.controllers[mode]?.abort();
          delete this.audioLeases[mode];
          delete this.audioSegments[mode];
          s.active = null;
          this.log(
            mode,
            "reading",
            "skipped",
            "Đã bỏ qua lượt; credit vẫn thuộc lượt cũ. Hoàn credit phải thao tác riêng.",
          );
        }
        break;
      case "replay":
        if (a) {
          this.controllers[mode]?.abort();
          a.paused = false;
          a.phaseStartedAt = now;
          a.phaseDuration = this.duration(a, a.phase);
          a.generation = (a.generation || 0) + 1;
          a.replayCount = (a.replayCount || 0) + 1;
          this.resetController(mode);
          delete this.audioLeases[mode];
          delete this.audioSegments[mode];
        }
        break;
      case "queue-edit": {
        const q = s.queue.find((q) => q.id === id);
        if (!q || !unresolved(q)) throw new Error("Chỉ sửa lượt đang chờ.");
        if (
          typeof action.question !== "string" ||
          action.question.length > this.config.maxQuestionLength ||
          action.question.length < 8
        )
          throw new Error("Câu hỏi cần từ 8 ký tự đến giới hạn cấu hình.");
        if (!TOPICS.includes(action.topic as Topic))
          throw new Error("Chủ đề không hợp lệ.");
        q.question = action.question.trim();
        q.topic = action.topic as Topic;
        q.updatedAt = now;
        this.qualify(q);
        break;
      }
      case "queue-approve": {
        const q = s.queue.find((q) => q.id === id);
        if (q && unresolved(q)) {
          q.approved = true;
          this.qualify(q);
        }
        break;
      }
      case "queue-move": {
        const list = s.queue
          .filter(unresolved)
          .sort((a, b) => (a.order ?? a.createdAt) - (b.order ?? b.createdAt));
        const i = list.findIndex((q) => q.id === id),
          j = i + (action.direction === "up" ? -1 : 1);
        if (i >= 0 && j >= 0 && j < list.length) {
          const ordered = list.map((q, index) => ({ q, value: now + index }));
          for (const row of ordered) row.q.order = row.value;
          const swap = list[i].order;
          list[i].order = list[j].order;
          list[j].order = swap;
        }
        break;
      }
      case "queue-skip": {
        const q = s.queue.find((q) => q.id === id);
        if (q && unresolved(q)) {
          q.status = "skipped";
          q.updatedAt = now;
        }
        break;
      }
      case "clear-queue":
        for (const q of s.queue)
          if (unresolved(q)) {
            q.status = "skipped";
            q.updatedAt = now;
          }
        this.log(
          mode,
          "queue",
          "cleared",
          "Đã bỏ qua toàn bộ lượt đang chờ; lịch sử và credit được giữ.",
        );
        break;
      case "credit-refund": {
        const c = s.credits.find((c) => c.id === id);
        if (!c) throw new Error("Không tìm thấy credit.");
        const q = s.queue.find((q) => q.id === c.usedBy);
        if (
          q &&
          [
            "reading",
            "ready",
            "waiting_condition",
            "waiting_question",
          ].includes(q.status)
        )
          throw new Error("Hãy hủy/bỏ qua lượt trước khi hoàn credit.");
        c.usedBy = undefined;
        c.refunded = true;
        this.log(
          mode,
          "credit",
          "refunded",
          `Credit ${c.id} được hoàn về số dư, chỉ dùng khi có yêu cầu mới.`,
        );
        break;
      }
      case "credit-confirm": {
        const c = s.credits.find((c) => c.id === id);
        if (!c || c.usedBy)
          throw new Error("Credit không tồn tại hoặc đã dùng.");
        if (
          typeof action.coins !== "number" ||
          !Number.isSafeInteger(action.coins) ||
          action.coins < 0 ||
          action.coins > 1e9
        )
          throw new Error("Xu xác nhận không hợp lệ.");
        c.coins = action.coins;
        c.review = undefined;
        this.log(
          mode,
          "credit",
          "confirmed",
          `Admin xác nhận ${c.coins} xu cho credit ${c.id}.`,
        );
        break;
      }
      case "credit-assign": {
        const q = s.queue.find((q) => q.id === id);
        if (!q || !unresolved(q))
          throw new Error("Chỉ ghép credit vào lượt đang chờ.");
        this.matchCredits(q, mode, true);
        this.qualify(q);
        this.log(
          mode,
          "credit",
          "assigned",
          "Admin ghép số dư tồn vào đúng ID tài khoản.",
        );
        break;
      }
      case "new-session":
        if (a)
          throw new Error(
            "Hãy kết thúc hoặc bỏ qua lượt đang đọc trước khi mở phiên mới.",
          );
        this.controllers[mode]?.abort();
        this.store.archive(mode, s);
        this.sessions[mode] = blankSession();
        this.restartHold.delete(mode);
        this.log(
          mode,
          "session",
          "new",
          "Phiên trước đã lưu vào lịch sử đối soát, baseline tim đã đặt lại.",
        );
        break;
      case "reconnect":
        this.onReconnect();
        break;
      case "audio-status":
        this.setAudioStatus(mode, String(action.status || ""));
        break;
      case "demo":
        if (mode !== "demo")
          throw new Error("Sự kiện mẫu chỉ được gửi vào phiên DEMO.");
        this.demo(String(action.scenario || "full"), action.envelope);
        break;
      case "next-phase":
        if (mode !== "demo") throw new Error("Chuyển nhanh chỉ dành cho DEMO.");
        this.advance(mode);
        break;
      default:
        throw new Error("Thao tác không được hỗ trợ.");
    }
    this.maybeCommunity(mode);
    this.maybeStart(mode);
    this.changed();
    return this.snapshot(mode);
  }
  private demo(scenario: string, envelope?: unknown) {
    const emit = (event: string, data: Record<string, unknown>) =>
      this.ingest(normalizeEnvelope({ event, data }), "demo");
    const user = (i: number) => ({
      userId: `demo-user-${i}`,
      uniqueId: `khach_${i}`,
      nickname:
        i === 1 || i === 2
          ? "Minh Anh"
          : [
              "Linh Chi",
              "Minh Anh",
              "Minh Anh",
              "Ngọc An",
              "Thảo Nhi",
              "Hoàng Nam",
              "Mộc Miên",
              "Khánh Vy",
              "Bảo Ngọc",
              "Hạ Lam",
            ][i % 10],
      profilePictureUrl: `/assets/avatars/avatar-${i % 10}.svg`,
    });
    const chat = (i: number) =>
      emit("chat", {
        ...user(i),
        msgId: randomUUID(),
        comment: `!tarot ${TOPICS[i % 5]} | ${["Tôi nên chú ý điều gì trong mối quan hệ hiện tại?", "Tôi nên xây dựng thói quen chi tiêu như thế nào?", "Giai đoạn tới tôi nên tập trung phát triển điều gì?", "Tôi có thể cải thiện cách học như thế nào?", "Làm sao để lắng nghe người thân tốt hơn?"][i % 5]}`,
      });
    const gift = (i: number, id = randomUUID()) =>
      emit("gift", {
        ...user(i),
        msgId: id,
        giftId: "5655",
        giftName: "Hoa hồng",
        giftType: 0,
        repeatCount: 1,
        repeatEnd: true,
        diamondCount: 1,
      });
    if (envelope !== undefined) {
      this.ingest(normalizeEnvelope(envelope), "demo");
      return;
    }
    if (scenario === "seed" || scenario === "full") {
      for (let i = 0; i < (scenario === "seed" ? 10 : 5); i++) {
        if (i % 2) {
          gift(i);
          chat(i);
        } else {
          chat(i);
          gift(i);
        }
      }
      if (scenario === "full") this.start("demo");
    } else if (scenario === "gift-first") {
      gift(7);
      chat(7);
    } else if (scenario === "question-first") {
      chat(8);
      gift(8);
    } else if (scenario === "combo") {
      const group = randomUUID();
      for (const [count, end] of [
        [1, false],
        [2, false],
        [3, false],
        [3, true],
        [3, true],
      ] as [number, boolean][])
        emit("gift", {
          ...user(9),
          msgId: `${group}-${count}-${end}`,
          groupId: group,
          giftId: "5655",
          giftName: "Hoa hồng",
          giftType: 1,
          repeatCount: count,
          repeatEnd: end,
          diamondCount: 1,
        });
      chat(9);
    } else if (scenario === "hearts") {
      const id = randomUUID();
      emit("like", { msgId: id, likeCount: this.config.heartGoal + 150 });
      emit("like", { msgId: id, likeCount: this.config.heartGoal + 150 });
    } else if (scenario === "ai-timeout") {
      const a = this.sessions.demo.active;
      if (a) {
        a.content = fallback(a);
        a.content.error =
          "DEMO: AI timeout; dùng nội dung biên soạn đúng các lá đã chốt.";
      }
      this.log(
        "demo",
        "ai",
        "fallback",
        "DEMO thử lỗi AI: không đổi cardId/vị trí/chiều.",
      );
    } else if (scenario === "tts-error") {
      this.audioStatuses.demo =
        "DEMO: TTS lỗi, tiếp tục bằng phụ đề và thời gian giữ chữ.";
      this.log("demo", "tts", "fallback", this.audioStatuses.demo);
    } else if (scenario === "disconnect" || scenario === "reconnect") {
      this.log(
        "demo",
        "connection",
        "simulated",
        `DEMO ${scenario}: không sửa trạng thái kết nối LIVE thật.`,
      );
      this.sessions.demo.notice = {
        text:
          scenario === "disconnect"
            ? "DEMO · thử mất kết nối"
            : "DEMO · thử kết nối lại",
        at: this.now(),
      };
    } else throw new Error("Kịch bản demo không tồn tại.");
  }
  currentText(mode: Mode) {
    const a = this.sessions[mode].active;
    return a ? phaseText(a) : "";
  }
  audioWait(mode: Mode, signature: string, waiting: boolean) {
    const a = this.sessions[mode].active;
    if (!a || a.paused || `${a.id}:${a.phase}:${a.generation}` !== signature)
      return;
    if (waiting) {
      this.audioStart(mode, a.id, a.phase, a.generation);
      const lease = this.audioLeases[mode];
      // Legacy clients may not heartbeat while the backend is synthesizing.
      if (lease)
        lease.expiresAt = Math.min(lease.hardDeadline, this.now() + 27000);
    }
  }
  audioDuration(
    mode: Mode,
    readingId: unknown,
    phase: unknown,
    generation: unknown,
    seconds: unknown,
  ) {
    const a = this.sessions[mode].active;
    if (
      !a ||
      a.paused ||
      a.id !== readingId ||
      a.phase !== phase ||
      a.generation !== generation ||
      typeof seconds !== "number" ||
      !Number.isFinite(seconds) ||
      seconds <= 0 ||
      seconds > 180
    )
      return;
    a.phaseDuration = Math.max(
      a.phaseDuration,
      Math.min(
        AUDIO_HARD_LIMIT_MS,
        this.now() - a.phaseStartedAt + seconds * 1000 + 1500,
      ),
    );
    this.changed(mode);
  }
  audioDone(
    mode: Mode,
    readingId: unknown,
    phase: unknown,
    generation: unknown,
  ) {
    const a = this.matchAudioReading(mode, readingId, phase, generation);
    if (!a || !this.audioOwners[mode]) return;
    delete this.audioLeases[mode];
    a.phaseDuration = this.now() - a.phaseStartedAt + AUDIO_END_TAIL_MS;
    this.audioStatuses[mode] =
      "Đã đọc xong đoạn; đang giữ nội dung trên sân khấu.";
    this.changed(mode);
  }
  history(mode: Mode) {
    return this.store.history(mode);
  }
  archived(id: number) {
    return this.store.archived(id);
  }
  close() {
    this.controllers.demo?.abort();
    this.controllers.live?.abort();
    this.save();
    this.store.close();
  }
}
