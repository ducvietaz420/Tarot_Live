import WebSocket from "ws";
import type { Connection, NormalizedEvent, User } from "../shared/types.ts";

export const DEFAULT_TIKFINITY_URL = "ws://localhost:21213/";
const MAX_FRAME_BYTES = 128 * 1024;
const SUPPORTED_EVENTS = new Set([
  "chat",
  "gift",
  "like",
  "follow",
  "share",
  "roomUser",
  "subscribe",
]);
type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
const text = (value: unknown, max = 500): string | undefined =>
  typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : undefined;
const count = (value: unknown): number | undefined => {
  if (typeof value === "string" && !/^\d+$/.test(value)) return;
  const result =
    typeof value === "number" || typeof value === "string"
      ? Number(value)
      : NaN;
  return Number.isSafeInteger(result) && result >= 0 ? result : undefined;
};
const booleanFlag = (value: unknown): boolean | undefined =>
  value === true || value === 1 || value === "1" || value === "true"
    ? true
    : value === false || value === 0 || value === "0" || value === "false"
      ? false
      : undefined;

function identifier(
  value: unknown,
  issues: string[],
  field: string,
): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed && trimmed.length <= 256 && trimmed !== "0"
      ? trimmed
      : undefined;
  }
  if (typeof value === "number") {
    if (Number.isSafeInteger(value) && value > 0) return String(value);
    if (value !== 0)
      issues.push(
        `${field}: ID số không an toàn; cần chuỗi để tránh mất chính xác`,
      );
  }
  return undefined;
}

function avatarURL(value: unknown): string | undefined {
  const candidate = text(value, 2048);
  if (!candidate) return;
  // App-owned demo portraits use the same normalizer without external requests.
  if (
    /^\/assets\/[\w./-]+$/.test(candidate) &&
    !candidate.split("/").includes("..")
  )
    return candidate;
  try {
    const parsed = new URL(candidate);
    return ["http:", "https:"].includes(parsed.protocol) &&
      !parsed.username &&
      !parsed.password
      ? parsed.href
      : undefined;
  } catch {
    return;
  }
}

/**
 * TikFinity's public envelope is { event, data }. Payloads differ across Desktop /
 * upstream releases, so both the legacy flattened and nested protobuf forms are
 * accepted. Values are not guessed when metadata or stable identity is absent.
 * Sources checked 2026-11-14: /tiktok/dapi, TTLC migration, gifts, chat-and-audience.
 */
export function normalizeEnvelope(input: unknown): NormalizedEvent {
  const issues: string[] = [];
  if (typeof input === "string") {
    if (Buffer.byteLength(input, "utf8") > MAX_FRAME_BYTES)
      return {
        type: "invalid",
        issues: ["Khung dữ liệu vượt giới hạn 128 KiB"],
      };
    try {
      input = JSON.parse(input);
    } catch {
      return { type: "invalid", issues: ["JSON không hợp lệ"] };
    }
  }
  const envelope = record(input);
  const event = text(envelope.event, 64);
  if (
    !event ||
    envelope.data === null ||
    typeof envelope.data !== "object" ||
    Array.isArray(envelope.data)
  ) {
    return {
      type: "invalid",
      issues: ["Cần envelope { event: string, data: object }"],
    };
  }
  const data = record(envelope.data);
  const nestedUser = record(data.user);
  const common = record(data.common);
  const gift = record(data.gift);
  const extended = record(data.extendedGiftInfo);
  const id = identifier(common.msgId ?? data.msgId, issues, "msgId");
  const roomId = identifier(common.roomId ?? data.roomId, issues, "roomId");
  const result: NormalizedEvent = {
    type: event,
    id,
    roomId,
    issues,
    rawKeys: Object.keys(data).slice(0, 40),
  };
  if (!SUPPORTED_EVENTS.has(event)) {
    issues.push(`Sự kiện chưa được hỗ trợ: ${event}`);
    return result;
  }
  const nestedId = identifier(nestedUser.id, issues, "user.id");
  const legacyId = identifier(data.userId, issues, "userId");
  const userId = nestedId ?? legacyId;
  const handle = text(nestedUser.displayId ?? data.uniqueId, 100);
  const nickname = text(nestedUser.nickname ?? data.nickname, 100);
  if (nestedId && legacyId && nestedId !== legacyId) {
    issues.push("Xung đột user.id và userId; không gán tài khoản");
  } else if (userId) {
    const profile = record(nestedUser.profilePicture ?? nestedUser.avatarThumb);
    const urls = profile.urlList ?? profile.urls;
    const avatar = avatarURL(
      nestedUser.profilePictureUrl ??
        data.profilePictureUrl ??
        profile.url ??
        (Array.isArray(urls) ? urls[0] : undefined),
    );
    const user: User = {
      id: userId,
      name: nickname ?? handle ?? "Tài khoản chưa có tên",
      handle,
      avatar,
    };
    result.user = user;
    if (!nickname && !handle) issues.push("Thiếu tên hiển thị");
  } else if (event !== "roomUser" && event !== "like") {
    issues.push(
      "Thiếu ID tài khoản ổn định; không ghép theo nickname/uniqueId",
    );
  }
  if (!id)
    issues.push(
      "Thiếu msgId; không thể chống phát lại hoàn toàn bằng ID sự kiện",
    );
  if (event === "chat") {
    result.comment = text(data.content ?? data.comment, 2000);
    if (!result.comment) issues.push("Thiếu nội dung bình luận");
  }
  if (event === "gift") {
    result.giftId = identifier(
      data.giftId ?? gift.id ?? gift.giftId,
      issues,
      "giftId",
    );
    result.giftName = text(gift.name ?? data.giftName ?? extended.name, 100);
    result.giftType = count(gift.type ?? data.giftType ?? extended.type);
    result.repeatCount = count(data.repeatCount);
    result.repeatEnd = booleanFlag(data.repeatEnd);
    result.comboId = identifier(
      data.groupId ?? data.comboId,
      issues,
      "groupId",
    );
    result.coins = count(
      gift.diamondCount ??
        data.diamondCount ??
        extended.diamondCount ??
        extended.diamond_count,
    );
    if (!result.giftId) issues.push("Thiếu giftId; cần đối soát loại quà");
    if (result.coins === undefined)
      issues.push(
        "Chưa biết giá trị xu; dùng bảng quy đổi admin hoặc đối soát",
      );
    if (result.repeatCount === undefined || result.repeatCount < 1)
      issues.push("Thiếu/sai repeatCount; không đoán số lượng quà");
    if (result.giftType === undefined)
      issues.push("Thiếu giftType/gift.type; chưa xác định quà combo");
    if (result.giftType === 1 && result.repeatEnd === undefined)
      issues.push("Thiếu repeatEnd của quà combo");
    if (result.giftType === 1 && !result.comboId)
      issues.push(
        "Thiếu groupId/comboId; không gộp tất cả quà cùng người và loại",
      );
    if (!result.comboId && !id)
      issues.push(
        "Thiếu định danh giao dịch tin cậy; cần admin đối soát trước khi cấp quyền lợi",
      );
  }
  if (event === "like") {
    result.likeCount = count(data.likeCount ?? data.count);
    result.totalLikeCount = count(data.totalLikeCount ?? data.total);
    if (result.likeCount === undefined && result.totalLikeCount === undefined)
      issues.push("Thiếu số tim tăng thêm và tổng tim");
  }
  return result;
}

export function validateTikFinityURL(input: string): string {
  if (typeof input !== "string" || input.length > 2048)
    throw new Error("URL TikFinity không hợp lệ");
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("URL TikFinity không hợp lệ");
  }
  if (!["ws:", "wss:"].includes(url.protocol) || url.username || url.password)
    throw new Error("TikFinity cần URL ws:// hoặc wss:// không kèm mật khẩu");
  return url.href;
}

/** Exactly one backend socket. Stale sockets cannot emit events after reconnect. */
export class TikFinityAdapter {
  private socket: WebSocket | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private generation = 0;
  private state: Connection;

  constructor(
    url: string = DEFAULT_TIKFINITY_URL,
    private readonly onEvent: (event: NormalizedEvent) => void = () => {},
    private readonly onStatus: (connection: Connection) => void = () => {},
  ) {
    this.state = {
      status: "disconnected",
      url: validateTikFinityURL(url),
      attempts: 0,
    };
  }

  get status(): Connection {
    return { ...this.state };
  }

  connect(url?: string): void {
    if (url && validateTikFinityURL(url) !== this.state.url) {
      this.updateURL(url);
      return;
    }
    this.running = true;
    if (this.socket || this.retryTimer) return;
    this.open();
  }

  reconnect(url?: string): void {
    if (url) this.state.url = validateTikFinityURL(url);
    this.closeSocket();
    this.state.attempts = 0;
    this.running = true;
    this.open();
  }

  updateURL(url: string): void {
    const valid = validateTikFinityURL(url);
    if (valid === this.state.url) return;
    this.reconnect(valid);
  }

  disconnect(): void {
    this.running = false;
    this.closeSocket();
    this.state.status = "disconnected";
    this.emitStatus();
  }

  stop(): void {
    this.disconnect();
  }

  private emitStatus(): void {
    this.onStatus(this.status);
  }

  private closeSocket(): void {
    this.generation++;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      // Keep a harmless error listener during terminate (CONNECTING emits error).
      socket.removeAllListeners();
      socket.on("error", () => {});
      socket.terminate();
    }
  }

  private open(): void {
    if (!this.running || this.socket) return;
    const generation = ++this.generation;
    this.state.status = "connecting";
    this.state.attempts++;
    this.emitStatus();
    const socket = new WebSocket(this.state.url, {
      maxPayload: MAX_FRAME_BYTES,
      handshakeTimeout: 5000,
      perMessageDeflate: false,
    });
    this.socket = socket;
    const current = () =>
      this.running && generation === this.generation && this.socket === socket;
    socket.on("open", () => {
      if (!current()) return;
      this.state.status = "connected";
      this.state.lastError = undefined;
      this.state.attempts = 0;
      this.emitStatus();
    });
    socket.on("message", (raw, isBinary) => {
      if (!current()) return;
      const normalized = isBinary
        ? {
            type: "invalid",
            issues: [
              "TikFinity gửi khung nhị phân; cần kiểm tra phiên bản/payload",
            ],
          }
        : normalizeEnvelope(raw.toString());
      // Socket connected is separate from an actual supported LIVE event received.
      if (SUPPORTED_EVENTS.has(normalized.type)) {
        this.state.lastEventAt = Date.now();
        this.emitStatus();
      }
      try {
        this.onEvent(normalized);
      } catch {
        this.state.lastError =
          "Ứng dụng không xử lý được một sự kiện; kiểm tra nhật ký";
        this.emitStatus();
      }
    });
    socket.on("error", (error) => {
      if (!current()) return;
      this.state.lastError = `TikFinity: ${(error as NodeJS.ErrnoException).code ?? "lỗi WebSocket"}`;
      this.emitStatus();
    });
    socket.on("close", () => {
      if (!current()) return;
      this.socket = null;
      this.state.status = "disconnected";
      this.emitStatus();
      const delay = Math.min(
        30_000,
        1000 * 2 ** Math.min(5, Math.max(0, this.state.attempts - 1)),
      );
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.open();
      }, delay);
      this.retryTimer.unref();
    });
  }
}
