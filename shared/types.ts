export type Mode = "demo" | "live";
export const TOPICS = [
  "Tình duyên",
  "Tiền bạc",
  "Công việc",
  "Học hành",
  "Gia đình",
] as const;
export type Topic = (typeof TOPICS)[number];
export type Phase =
  | "idle"
  | "locking"
  | "shuffling"
  | "dealing"
  | "card1"
  | "card2"
  | "card3"
  | "summary"
  | "complete";
export type QueueStatus =
  | "waiting_question"
  | "waiting_condition"
  | "ready"
  | "reading"
  | "completed"
  | "skipped";
export interface Card {
  id: string;
  vi: string;
  en: string;
  group: string;
  asset: string;
  keywords: string[];
  upright: string;
  reversed: string;
  topics: Record<Topic, string>;
}
export interface DrawnCard {
  cardId: string;
  position: number;
  reversed: boolean;
}
export interface User {
  id: string;
  name: string;
  handle?: string;
  avatar?: string;
}
export interface QueueItem {
  id: string;
  user: User;
  topic: Topic;
  question: string;
  status: QueueStatus;
  createdAt: number;
  updatedAt: number;
  coins: number;
  creditIds: string[];
  community?: boolean;
  approved?: boolean;
  order?: number;
  readingId?: string;
}
export interface ReadingSection {
  cardId: string;
  position: number;
  reversed: boolean;
  text: string;
  speech: string;
}
export interface ReadingContent {
  opening: string;
  cards: ReadingSection[];
  summary: string;
  source: "fallback" | "ai";
  error?: string;
}
export interface Reading {
  id: string;
  itemId: string;
  user: User;
  topic: Topic;
  question: string;
  cards: DrawnCard[];
  content: ReadingContent;
  phase: Phase;
  paused: boolean;
  phaseStartedAt: number;
  phaseDuration: number;
  remainingMs?: number;
  createdAt: number;
  config: Config;
  community?: boolean;
  generation?: number;
  replayCount?: number;
}
export interface Credit {
  id: string;
  userId: string;
  coins: number | null;
  count: number;
  giftId: string;
  giftName: string;
  at: number;
  usedBy?: string;
  review?: string;
  roomId?: string;
  refunded?: boolean;
}
export interface EventLog {
  id: string;
  at: number;
  source: Mode;
  event: string;
  status: string;
  detail: string;
}
export interface Connection {
  status: "connecting" | "connected" | "disconnected";
  url: string;
  attempts: number;
  lastEventAt?: number;
  lastError?: string;
}
export interface HeartState {
  total: number;
  baseline?: number;
  cumulative?: number;
  milestones: number;
  consumed?: number;
  lastCommunityAt?: number;
  roomId?: string;
}
export interface Session {
  queue: QueueItem[];
  active: Reading | null;
  credits: Credit[];
  hearts: HeartState;
  logs: EventLog[];
  seen: Record<string, number>;
  combos: Record<string, { count: number; finalized: boolean }>;
  notice?: { text: string; at: number };
  roomId?: string;
}
export interface Config {
  shopName: string;
  instruction: string;
  footer: string;
  accent: string;
  cyan: string;
  fontScale: number;
  safeTop: number;
  safeBottom: number;
  safeX: number;
  reducedMotion: boolean;
  fps: number;
  characterAsset: string;
  backgroundAsset: string;
  cardBackAsset: string;
  cardAssets: Record<string, string>;
  joinMode: "free" | "gift_question" | "gift_priority";
  minCoins: number;
  giftValues: Record<string, number>;
  command: string;
  matchWindowSec: number;
  cooldownSec: number;
  maxQuestionLength: number;
  priority: boolean;
  maxWaitSec: number;
  moderation: boolean;
  accepting: boolean;
  autoRun: boolean;
  reversed: boolean;
  heartGoal: number;
  communityCooldownSec: number;
  maxCommunityPending: number;
  durations: Record<
    "locking" | "shuffling" | "dealing" | "card" | "summary" | "complete",
    number
  >;
  aiEnabled: boolean;
  aiModel: string;
  aiTimeoutSec: number;
  displayWords: number;
  summaryWords: number;
  ttsProvider: "browser" | "http" | "off";
  voice: string;
  speechRate: number;
  speechVolume: number;
  music: boolean;
  musicVolume: number;
  sfx: boolean;
}
export interface AudioSegment {
  readingId: string;
  phase: Phase;
  generation: number;
  text: string;
  index: number;
  charIndex?: number;
  timing?: "boundary" | "estimated";
}
export interface Snapshot {
  mode: Mode;
  config: Config;
  session: Session;
  connection: Connection;
  audioOwner: string | null;
  audioOwnerMode?: Mode;
  serverTime: number;
  capabilities: { ai: boolean; tts: boolean };
  audioStatus?: string;
  audioSegment?: AudioSegment;
  audioActive?: boolean;
}
export interface NormalizedEvent {
  type: string;
  id?: string;
  roomId?: string;
  user?: User;
  comment?: string;
  giftId?: string;
  giftName?: string;
  coins?: number;
  repeatCount?: number;
  repeatEnd?: boolean;
  giftType?: number;
  comboId?: string;
  likeCount?: number;
  totalLikeCount?: number;
  issues: string[];
  rawKeys?: string[];
}
export type Action = { type: string; [key: string]: unknown };
