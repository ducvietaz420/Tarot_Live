import React, { useEffect, useRef, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import {
  TOPICS,
  type Action,
  type Config,
  type Mode,
  type Snapshot,
} from "../shared/types";
import { CARDS } from "../shared/cards";
import "./style.css";
import { useAudio, currentSpeech } from "./audio";
import { useSession } from "./session";
import { sentenceRanges } from "../shared/text";
import CreditLedger from "./CreditLedger";
import { ReadingText } from "./ReadingText";
import FollowUpPanel from "./FollowUpPanel";
import DeckRitual from "./DeckRitual";
import ViewerPrompt from "./ViewerPrompt";
import { deriveFollowUpState } from "../shared/followup";

const number = (n: number) => new Intl.NumberFormat("vi-VN").format(n);
const time = (n?: number) =>
  n ? new Date(n).toLocaleTimeString("vi-VN") : "Chưa nhận";
const statuses: Record<string, string> = {
  waiting_question: "Chờ câu hỏi",
  waiting_condition: "Chờ điều kiện",
  ready: "Sẵn sàng",
  reading: "Đang đọc",
  completed: "Hoàn tất",
  skipped: "Đã bỏ qua",
};
const phases: Record<string, string> = {
  idle: "Đang đợi một lời nhắn",
  locking: "Kết nối với câu hỏi của bạn",
  shuffling: "Đang xào bài",
  dealing: "Ba thông điệp dành cho bạn",
  card1: "Thông điệp từ quá khứ",
  card2: "Năng lượng hiện tại",
  card3: "Hướng đi phía trước",
  summary: "Lời nhắn dành cho bạn",
  followup: "Bạn muốn hỏi thêm điều gì?",
  answer: "Giải đáp từ trải bài vừa mở",
  complete: "Cảm ơn bạn đã ghé tiệm",
};
const positions = ["Quá khứ", "Hiện tại", "Tương lai"];

function Icon({
  name,
  size = 20,
  ...props
}: {
  name: string;
  size?: number;
  [key: string]: unknown;
}) {
  const paths: Record<string, React.ReactNode> = {
    star: (
      <>
        <path d="m12 2 2.7 6.5L22 12l-7.3 2.2L12 22l-2.7-7.8L2 12l7.3-3.5Z" />
        <path d="M12 8v8M8 12h8" />
      </>
    ),
    home: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="3" />
        <path d="M3 9h18M9 9v11" />
      </>
    ),
    play: <path d="m8 4 12 8-12 8Z" />,
    pause: (
      <>
        <path d="M8 5v14M16 5v14" />
      </>
    ),
    skip: (
      <>
        <path d="m5 5 11 7-11 7Z" />
        <path d="M19 5v14" />
      </>
    ),
    reset: (
      <>
        <path d="M4 9a8 8 0 1 1 0 7" />
        <path d="M4 3v6h6" />
      </>
    ),
    queue: (
      <>
        <path d="M8 6h13M8 12h13M8 18h13" />
        <circle cx="3" cy="6" r=".5" />
        <circle cx="3" cy="12" r=".5" />
        <circle cx="3" cy="18" r=".5" />
      </>
    ),
    settings: (
      <>
        <path d="M4 6h16M4 12h16M4 18h16" />
        <circle cx="9" cy="6" r="2" />
        <circle cx="16" cy="12" r="2" />
        <circle cx="8" cy="18" r="2" />
      </>
    ),
    paint: (
      <>
        <path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-3.8c-.9-.5-.7-2.2.6-2.2H17a4 4 0 0 0 4-4 9 9 0 0 0-9-8Z" />
        <path d="M7 9h.01M11 6h.01M16 8h.01M6 14h.01" />
      </>
    ),
    sound: (
      <>
        <path d="m11 4-6 5H2v6h3l6 5Z" />
        <path d="M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14" />
      </>
    ),
    link: (
      <>
        <path
          d="m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"
          transform="translate(1 0) scale(.9)"
        />
      </>
    ),
    external: (
      <>
        <path d="M14 3h7v7M21 3 11 13" />
        <path d="M10 3H4a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-6" />
      </>
    ),
    heart: (
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />
    ),
    arrow: <path d="m9 5 7 7-7 7" />,
    check: <path d="m5 12 4 4L20 5" />,
    download: (
      <>
        <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />
      </>
    ),
    log: (
      <>
        <path d="m8 8-4 4 4 4M14 8l4 4-4 4" />
      </>
    ),
    moon: <path d="M20 14A9 9 0 0 1 10 3a9 9 0 1 0 10 11Z" />,
    gift: (
      <>
        <rect x="3" y="9" width="18" height="4" rx="1" />
        <path d="M5 13v8h14v-8M12 9v12M12 9C2 9 5 0 9 4l3 5c10 0 7-9 3-5Z" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name] || paths.star}
    </svg>
  );
}
function Avatar({
  user,
  size = 44,
}: {
  user: { name: string; avatar?: string; id?: string };
  size?: number;
}) {
  const [bad, setBad] = useState(false);
  useEffect(() => setBad(false), [user.avatar]);
  const hue =
    ([...(user.id || user.name)].reduce((a, c) => a + c.charCodeAt(0), 0) %
      100) +
    250;
  return (
    <span
      className="avatar"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(140deg,hsl(${hue} 35% 37%),hsl(${hue + 30} 35% 18%))`,
        fontSize: size * 0.33,
      }}
    >
      {user.avatar && !bad ? (
        <img src={user.avatar} alt="" onError={() => setBad(true)} />
      ) : (
        user.name
          .split(" ")
          .slice(-2)
          .map((x) => x[0])
          .join("")
      )}
    </span>
  );
}
function useClock() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, []);
  return now;
}
function Stage({
  state,
  guides = false,
}: {
  state: Snapshot;
  guides?: boolean;
}) {
  const { config: c, session: s, mode } = state;
  const r = s.active;
  const phase = r?.phase || "idle";
  const activeIndex = ["card1", "card2", "card3"].indexOf(phase);
  const sceneRef = useRef<HTMLElement>(null);
  const [sceneRatio, setSceneRatio] = useState(1);
  useEffect(() => {
    const observer = new ResizeObserver((entries) =>
      setSceneRatio(Math.min(1, entries[0].contentRect.height / 330)),
    );
    if (sceneRef.current) observer.observe(sceneRef.current);
    return () => observer.disconnect();
  }, []);
  const now = useClock();
  const intake = !r && s.intake
    ? s.queue.find((item) => item.id === s.intake!.itemId)
    : undefined;
  const intakeSeconds = Math.max(0, Math.ceil(((s.intake?.deadline || now) - now) / 1000));
  const followUp = r?.followUp;
  const followUpQuestion = followUp?.questions.find(
    (question) => question.id === followUp.currentQuestionId,
  );
  const isFollowUp = phase === "followup" || phase === "answer";
  const followUpView = r ? deriveFollowUpState(r, now) : undefined;
  const followUpSeconds = followUpView?.seconds || 0;
  const followUpClock = `${Math.floor(followUpSeconds / 60)}:${String(followUpSeconds % 60).padStart(2, "0")}`;
  const awaitingFollowUp = !!followUpView?.waiting;
  const elapsed = r
    ? Math.max(
        0,
        (r.paused
          ? r.phaseDuration - (r.remainingMs ?? r.phaseDuration)
          : now - r.phaseStartedAt) / 1000,
      )
    : 0;
  const readingText =
    activeIndex >= 0
      ? r?.content.cards[activeIndex]?.text
      : phase === "summary"
        ? r?.content.summary
        : phase === "answer"
          ? followUpQuestion?.answer || "Đang chuẩn bị câu trả lời."
        : phase === "followup"
          ? followUpQuestion?.status === "generating"
            ? "AI đang đọc lại ba lá và nội dung vừa giải để trả lời câu hỏi của bạn."
            : awaitingFollowUp
              ? `${r?.user.name}, hãy viết câu hỏi ở bình luận tiếp theo. Tiệm đang chờ câu hỏi của bạn; còn ${followUpClock}.`
              : `Bạn còn ${Math.max(0, 3 - (followUp?.questions.length || 0))} câu hỏi tiếp về trải bài này. Viết thẳng câu hỏi trong bình luận; mỗi câu có 30 giây để hỏi. Chỉ tài khoản vừa xem bài mới được hỏi tiếp.`
        : phase === "complete"
          ? "Hãy giữ lại điều chạm đến bạn, và để những điều còn lại nhẹ nhàng đi qua."
          : r
            ? (
                {
                  locking:
                    "Câu hỏi đã được giữ lại. Hít thở nhẹ nhàng, chúng ta cùng bắt đầu.",
                  shuffling:
                    "Nhẹ nhàng xào bộ bài, dành một khoảng lặng để lắng nghe chính mình.",
                  dealing:
                    "Ba lá bài đã được rút riêng cho câu chuyện của bạn.",
                } as Record<string, string>
              )[phase] || phases[phase]
            : "Khẽ thả lỏng tâm trí. Gửi câu hỏi bạn muốn lắng nghe, để ba lá bài mở ra một góc nhìn mới.";
  const fullText = readingText || "";
  const ranges = sentenceRanges(fullText);
  const segment = state.audioSegment;
  const speakingSegment =
    r &&
    segment?.readingId === r.id &&
    segment.phase === r.phase &&
    segment.generation === r.generation
      ? segment
      : undefined;
  const phaseKey = `${r?.id || "idle"}:${phase}:${followUp?.currentQuestionId || ""}`;
  const ritualKey = `${phaseKey}:${r?.replayCount || 0}`;
  const ritualTiming = useRef({ key: "", offset: 0, duration: 5000 });
  if (ritualTiming.current.key !== ritualKey) {
    // Resume shortens phaseDuration to the time left. Keep the original CSS
    // timeline so a paused shuffle/fan continues instead of jumping to its end.
    const duration = r && (phase === "shuffling" || phase === "dealing")
      ? Math.max(r.config.durations[phase] * 1000, r.phaseDuration)
      : 5000;
    const remaining = r
      ? r.paused
        ? r.remainingMs ?? r.phaseDuration
        : r.phaseDuration - (now - r.phaseStartedAt)
      : duration;
    ritualTiming.current = {
      key: ritualKey,
      duration,
      offset: -Math.max(0, duration - remaining),
    };
  }
  const timedChar = Math.max(
    0,
    Math.min(
      fullText.length - 1,
      Math.floor(
        (elapsed / Math.max(1, (r?.phaseDuration || 1000) / 1000)) *
          fullText.length,
      ),
    ),
  );
  const audioChar =
    speakingSegment?.charIndex ??
    (speakingSegment ? Math.max(0, fullText.indexOf(speakingSegment.text)) : 0);
  const nextChar = state.audioActive ? audioChar : timedChar;
  const lastChar = useRef({ phaseKey, value: 0 });
  if (lastChar.current.phaseKey !== phaseKey)
    lastChar.current = { phaseKey, value: 0 };
  if (!r?.paused) lastChar.current.value = nextChar;
  const charIndex = r?.paused ? lastChar.current.value : nextChar;
  const card =
    activeIndex >= 0
      ? CARDS.find((x) => x.id === r?.cards[activeIndex]?.cardId)
      : undefined;
  const captionText = r ? currentSpeech(state) : "";
  const sentenceIndex = Math.max(
    0,
    ranges.findIndex((range) => charIndex < range.end),
  );
  const captionSentence = captionText
    ? ranges[sentenceIndex]?.text || captionText
    : "";
  const pendingQueue = s.queue
    .filter((q) =>
      ["ready", "waiting_question", "waiting_condition"].includes(q.status) &&
      (!q.roomId || !s.roomId || q.roomId === s.roomId),
    );
  const queue = pendingQueue.slice(0, 4);
  const totalQueue = pendingQueue.length;
  const goal = c.heartGoal;
  const remainder = Math.max(
    0,
    s.hearts.total - (s.hearts.consumed ?? s.hearts.milestones * goal),
  );
  const progress = Math.min(100, (remainder / goal) * 100);
  const join = "Tặng quà hoặc bình luận tarot · Quà được ưu tiên";
  const guide = (text: string) =>
    text
      .replaceAll("{command}", "tarot")
      .replaceAll("{minCoins}", number(c.minCoins))
      .replaceAll("{heartGoal}", number(c.heartGoal));
  const style = {
    "--accent": c.accent,
    "--cyan": c.cyan,
    "--font-scale": c.fontScale,
    "--safe-top": `${c.safeTop}px`,
    "--safe-bottom": `${c.safeBottom}px`,
    "--safe-x": `${c.safeX}px`,
    "--breathe-frames": c.fps * 6,
    "--twinkle-frames": c.fps * 5,
    "--scene-ratio": sceneRatio,
    "--ritual-duration": `${ritualTiming.current.duration}ms`,
    "--ritual-offset": `${ritualTiming.current.offset}ms`,
    backgroundImage:
      c.backgroundAsset && !/\.(mp4|webm)(\?|$)/i.test(c.backgroundAsset)
        ? `linear-gradient(#110b2290,#110b2290),url("${c.backgroundAsset.replaceAll('"', "%22")}")`
        : undefined,
  } as React.CSSProperties;
  return (
    <div
      className={`stage ${c.backgroundAsset ? "custom-background" : ""} ${c.reducedMotion ? "reduced" : ""} ${r?.paused ? "is-paused" : ""} ${guides ? "has-guides" : ""}`}
      style={style}
      data-phase={phase}
    >
      {/\.(mp4|webm)(\?|$)/i.test(c.backgroundAsset) && (
        <video
          className="stage-background-video"
          src={c.backgroundAsset}
          autoPlay
          loop
          muted
          playsInline
        />
      )}
      <div className="nebula nebula-one" />
      <div className="nebula nebula-two" />
      <div className="star-field">
        {Array.from({ length: 35 }, (_, i) => (
          <i
            key={i}
            style={{
              left: `${(i * 37 + 11) % 100}%`,
              top: `${(i * 19 + 3) % 85}%`,
              animationDelay: `-${i * 0.7}s`,
              width: i % 5 === 0 ? 4 : 2,
              height: i % 5 === 0 ? 4 : 2,
            }}
          />
        ))}
      </div>
      <div className="stage-content">
        <header className="stage-heading">
          <div className="celestial-eyebrow">
            <span />✦ KẾT NỐI CÙNG VŨ TRỤ ✦<span />
          </div>
          <h1>{c.shopName}</h1>
          <p>{guide(c.instruction)}</p>
          <div className="stage-pills">
            <span>
              <i /> {mode === "demo" ? "PHIÊN DEMO" : "TAROT LIVE"}
            </span>
            <b>✧</b>
            <span>{join}</span>
          </div>
        </header>
        <section className="reader-scene" ref={sceneRef}>
          <div className="orbit orbit-outer" />
          <div className="orbit orbit-inner" />
          <div className="reader-arch">
            <div className="arch-inside" />
            <div className="arch-stars">
              ✧<span>☽</span>✦
            </div>
            <div className="character-wrap">
              {/\.(mp4|webm)(\?|$)/i.test(c.characterAsset) ? (
                <video src={c.characterAsset} autoPlay loop muted playsInline />
              ) : (
                <img
                  src={c.characterAsset || "/assets/tarot-reader.png"}
                  alt="Nhân vật nữ đọc tarot trong trang phục tím"
                  onError={(e) => {
                    e.currentTarget.src = "/assets/tarot-reader.png";
                  }}
                />
              )}
            </div>
          </div>
          <aside className="heart-widget">
            <div className="tiny-label">NĂNG LƯỢNG CẢ PHÒNG</div>
            <div
              className="heart-orb"
              style={{ "--progress": `${progress}%` } as React.CSSProperties}
            >
              <div>
                <Icon name="heart" size={48} />
                <strong>{number(remainder)}</strong>
                <span>/ {number(goal)} tim</span>
              </div>
            </div>
            <div className="orb-caption">
              Cùng mở một
              <br />
              <b>lá bài chung</b>
            </div>
            <div className="mini-progress">
              <i style={{ width: `${progress}%` }} />
            </div>
            <small>Đã nhận {number(s.hearts.total)} tim</small>
          </aside>
          <aside className="stage-queue">
            <h3>
              <Icon name="queue" size={21} /> Hàng chờ xem bài
            </h3>
            <div className="queue-line" />
            {queue.length ? (
              queue.map((q, i) => (
                <div className="stage-queue-row" key={q.id}>
                  <span className="queue-no">0{i + 1}</span>
                  <Avatar user={q.user} size={36} />
                  <div>
                    <b>{q.user.name}</b>
                    <span>
                      {q.status === "ready" ? q.topic : statuses[q.status]}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="queue-empty">
                <Icon name="moon" size={32} />
                <p>
                  Một khoảng lặng
                  <br />
                  cho câu chuyện tiếp theo
                </p>
              </div>
            )}
            <footer>
              <i />{" "}
              {totalQueue
                ? `${totalQueue} người đang chờ`
                : "Tiệm đang đón bạn"}
            </footer>
          </aside>
          <div className="reader-name">
            <span />
            THE TAROT READER
            <span />
          </div>
        </section>
        <section className={`seeker-panel ${r?.community ? "community" : ""}`}>
          <Avatar user={r?.user || intake?.user || { name: "Câu chuyện của bạn" }} size={68} />
          <div>
            <div className="seeker-caption">
              {r?.community
                ? "THÔNG ĐIỆP CHUNG CHO CẢ PHÒNG"
                : r
                  ? isFollowUp ? "HỎI ĐÁP SAU TRẢI BÀI" : "ĐANG XEM BÀI CHO"
                  : intake ? "ĐANG LẮNG NGHE CÂU HỎI CỦA" : "MỘT CHÚT LẮNG NGHE, MỘT CHÚT THẤU HIỂU"}
            </div>
            <h2>
              {r?.user.name || intake?.user.name || "Vũ trụ đang lắng nghe"}{" "}
              {r && <span>{r.topic}</span>}
            </h2>
            <p>{r?.question || (intake?.topicChosen ? `Chia sẻ thêm điều bạn muốn biết về ${intake.topic.toLocaleLowerCase("vi")}.` : "Bạn đang mang trong mình câu hỏi nào?")}</p>
          </div>
          <span className="seeker-star">✧</span>
        </section>
        <section
          className={`interpretation ${activeIndex >= 0 || phase === "answer" ? "is-reading" : ""} ${isFollowUp ? "followup-interpretation" : ""} ${intake || awaitingFollowUp ? "prompt-interpretation" : ""}`}
        >
          {intake || awaitingFollowUp ? (
            <ViewerPrompt intake={intake} reading={r || undefined} seconds={intake ? intakeSeconds : followUpSeconds} />
          ) : <>
          <div className="interpretation-top">
            <span>
              <i />
              {activeIndex >= 0
                ? `LÁ ${activeIndex + 1}/3 · ${positions[activeIndex].toLocaleUpperCase("vi")}`
                : phase === "summary"
                  ? "KẾT NỐI BA THÔNG ĐIỆP"
                  : isFollowUp
                    ? `HỎI ĐÁP · ${followUp?.questions.length || 0}/3 CÂU${awaitingFollowUp ? ` · ${followUpClock}` : ""}`
                  : r
                    ? "HÀNH TRÌNH CỦA BẠN"
                    : "DÀNH MỘT KHOẢNG LẶNG CHO BẠN"}
            </span>
            <b>✧</b>
            <span>
              {r?.paused
                ? "ĐÃ TẠM DỪNG"
                : (phase === "answer" && followUpQuestion?.status === "answered") || r?.content.source === "ai"
                  ? "AI CÁ NHÂN HÓA"
                  : "CHIÊM NGHIỆM CÙNG TAROT"}
            </span>
          </div>
          <h2>
            {card?.vi || (phase === "answer"
              ? `Trả lời câu ${Math.max(1, (followUp?.questions.findIndex((question) => question.id === followUp.currentQuestionId) ?? 0) + 1)}`
              : phases[phase])}
            {card && (
              <small>
                {card.en} ·{" "}
                {r?.cards[activeIndex].reversed ? "Chiều ngược" : "Chiều xuôi"}
              </small>
            )}
          </h2>
          {isFollowUp && followUpQuestion && (
            <p className="followup-stage-question">{followUpQuestion.question}</p>
          )}
          <ReadingText
            text={fullText}
            charIndex={charIndex}
            tracking={!!captionText}
            paused={!!r?.paused}
            reducedMotion={c.reducedMotion}
            phaseKey={phaseKey}
          />
          <div className="interpretation-bottom">
            <span>✦</span>
            <i />
            <small>{isFollowUp
              ? awaitingFollowUp
                ? `Đang chờ câu hỏi của ${r?.user.name} · ${followUpClock}`
                : "Mỗi câu hỏi được lắng nghe và giải đáp riêng"
              : "Lắng nghe trực giác của bạn"}</small>
            <i />
            <span>✦</span>
          </div>
          </>}
        </section>
        <section
          className={`spread ${phase === "shuffling" ? "shuffling" : ""} ${phase === "dealing" ? "dealing" : ""}`}
        >
          <div className="spread-heading">
            <span />
            BA LÁ BÀI · MỘT HÀNH TRÌNH
            <span />
          </div>
          <div className="cards-row">
            {positions.map((p, i) => {
              const draw = r?.cards[i];
              const cd = CARDS.find((x) => x.id === draw?.cardId);
              const revealed =
                !!r &&
                (phase === "summary" ||
                  isFollowUp ||
                  phase === "complete" ||
                  activeIndex >= i);
              return (
                <div
                  className={`card-slot ${activeIndex === i ? "active" : ""} ${revealed ? "revealed" : ""}`}
                  key={i}
                >
                  <div className="position-name">
                    <span>0{i + 1}</span> {p}
                  </div>
                  <div className="tarot-card">
                    <div className="card-flipper">
                      <div className="card-side card-back">
                        <img
                          src={c.cardBackAsset || "/assets/card-back.svg"}
                          alt="Mặt sau lá bài"
                          onError={(e) => {
                            e.currentTarget.src = "/assets/card-back.svg";
                          }}
                        />
                      </div>
                      <div className="card-side card-front">
                        <img
                          src={
                            cd
                              ? c.cardAssets[cd.id] || cd.asset
                              : "/assets/card-back.svg"
                          }
                          alt={cd?.vi || "Lá bài chưa lật"}
                          style={{
                            transform: draw?.reversed
                              ? "rotate(180deg)"
                              : undefined,
                          }}
                          onError={(e) => {
                            e.currentTarget.src = "/assets/card-back.svg";
                          }}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="card-under">
                    {revealed && <strong>{cd?.vi}</strong>}
                    <span>
                      {revealed
                        ? draw?.reversed
                          ? "☾ CHIỀU NGƯỢC"
                          : "✧ CHIỀU XUÔI"
                        : "✧ CHỜ THÔNG ĐIỆP"}
                    </span>
                  </div>
                </div>
              );
            })}
            <div className="deck-stack">
              <img
                src={c.cardBackAsset || "/assets/card-back.svg"}
                alt="Chồng bài úp"
              />
              <img src={c.cardBackAsset || "/assets/card-back.svg"} alt="" />
              <img src={c.cardBackAsset || "/assets/card-back.svg"} alt="" />
            </div>
          </div>
          {(phase === "shuffling" || phase === "dealing") && (
            <DeckRitual key={ritualKey} phase={phase}
              back={c.cardBackAsset || "/assets/card-back.svg"} />
          )}
        </section>
        <div
          className={`caption-bar ${captionText && !r?.paused ? "speaking" : ""}`}
        >
          <span className="sound-wave">
            {[0, 1, 2, 3, 4].map((i) => (
              <i key={i} style={{ animationDelay: `${i * 0.12}s` }} />
            ))}
          </span>
          <ReadingText
            text={
              r?.paused
                ? "Lượt đọc đang tạm dừng"
                : captionSentence ||
                  (phase === "followup"
                    ? awaitingFollowUp
                      ? `Đang chờ ${r?.user.name} bình luận câu hỏi · ${followUpClock} còn lại`
                      : `${r?.user.name}, tiệm đang lắng nghe câu hỏi của bạn.`
                    : "Hít thở thật chậm. Mọi câu trả lời đều bắt đầu từ bên trong bạn.")
            }
            charIndex={Math.max(
              0,
              charIndex - (ranges[sentenceIndex]?.start || 0),
            )}
            tracking={!!captionText && !r?.paused}
            paused={!!r?.paused}
            reducedMotion={c.reducedMotion}
            phaseKey={`caption:${phaseKey}:${sentenceIndex}`}
            label="Phụ đề lời đọc"
          />
          <span>✧</span>
        </div>
        <footer className="stage-footer">
          <p>{guide(c.footer)}</p>
          <div className="topic-pills">
            {TOPICS.map((t, i) => (
              <span key={t}>
                {["♡", "✦", "♧", "✎", "⌂"][i]} {t}
              </span>
            ))}
          </div>
          <small>Nội dung mang tính giải trí và tự chiêm nghiệm</small>
          <div className="bottom-ornament">─────── ✧ ☾ ✧ ───────</div>
        </footer>
      </div>
      {s.notice && now - s.notice.at < 8000 && (
        <div className="social-notice" key={s.notice.at}>
          ✧ {s.notice.text}
        </div>
      )}
      {guides && (
        <div className="safe-guides">
          <span>
            VÙNG AN TOÀN · {c.safeX} / {c.safeTop} / {c.safeBottom}px
          </span>
        </div>
      )}
    </div>
  );
}

function StageFrame({
  state,
  guides = false,
  overlay = false,
}: {
  state: Snapshot;
  guides?: boolean;
  overlay?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);
  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setScale(Math.min(width / 1080, height / 1920));
    });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div className={overlay ? "overlay-frame" : "stage-frame"} ref={ref}>
      <div
        className="scaled-stage"
        style={{ width: 1080 * scale, height: 1920 * scale }}
      >
        <div
          style={{
            width: 1080,
            height: 1920,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        >
          <Stage state={state} guides={guides} />
        </div>
      </div>
    </div>
  );
}

const navItems = [
  ["studio", "home", "Phòng điều hành"],
  ["queue", "queue", "Hàng chờ xem bài"],
  ["rules", "settings", "Quy tắc tham gia"],
  ["appearance", "paint", "Sân khấu & giao diện"],
  ["audio", "sound", "Nội dung & âm thanh"],
  ["connection", "link", "Kết nối & sự kiện"],
];
function App() {
  const isOverlay = location.pathname.startsWith("/overlay");
  const isDemo = location.pathname.startsWith("/demo");
  const initialMode: Mode =
    isDemo || new URLSearchParams(location.search).get("mode") === "demo"
      ? "demo"
      : "live";
  const [mode, setMode] = useState<Mode>(initialMode);
  const {
    state,
    action: sendAction,
    error,
    setError,
    online,
    socket,
    clientId,
  } = useSession(mode);
  const audio = useAudio(state, socket, clientId, online);
  const [section, setSection] = useState("studio");
  const [guides, setGuides] = useState(false);
  const [toast, setToast] = useState("");
  const action = async (a: Action) => {
    const ok = await sendAction(a);
    if (ok && (a.type === "demo" || a.type === "next-phase") && mode !== "demo")
      setMode("demo");
    return ok;
  };
  const inform = (s: string) => {
    setToast(s);
    setTimeout(() => setToast(""), 3500);
  };
  if (!state)
    return (
      <div className="loading-screen">
        <Icon name="star" size={44} />
        <h1>TIỆM TAROT</h1>
        <p>{error || "Đang kết nối sân khấu…"}</p>
      </div>
    );
  const { config: c, session: s, connection } = state;
  const intakeItem = s.intake ? s.queue.find((item) => item.id === s.intake!.itemId) : undefined;
  const pending = s.queue.filter(
    (q) => !["completed", "skipped", "reading"].includes(q.status),
  );
  const ready = pending.filter((q) => q.status === "ready");
  const lastFollowUp = s.recentReadings?.find((reading) => reading.followUp?.questions.length);
  const save = async (patch: Partial<Config>) => {
    if (await action({ type: "config", config: patch }))
      inform("Đã lưu cấu hình");
  };
  if (isOverlay)
    return (
      <>
        <StageFrame
          state={state}
          overlay
          guides={new URLSearchParams(location.search).has("guides")}
        />
        {!audio.owner && (
          <button
            className="overlay-audio"
            disabled={audio.busy || audio.requesting}
            onClick={state.audioOwner ? audio.transfer : audio.enable}
            title={audio.status}
          >
            <Icon name="sound" size={16} />{" "}
            {audio.busy
              ? "Âm thanh ở phiên khác"
              : state.audioOwner
                ? "Chuyển âm thanh sang overlay này"
                : "Bật âm thanh"}
          </button>
        )}
        {!online && (
          <div className="overlay-offline">
            Mất kết nối máy chủ · đang thử lại
          </div>
        )}
      </>
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href={isDemo ? "/demo" : "/admin"}>
          <span className="brand-symbol">
            <Icon name="star" size={28} />
          </span>
          <div>
            tiệm tarot<span>INTERACTIVE LIVE STUDIO</span>
          </div>
        </a>
        <div className="workspace-label">KHÔNG GIAN CỦA BẠN</div>
        <nav>
          {navItems.map(([id, icon, label]) => (
            <button
              key={id}
              className={section === id ? "active" : ""}
              onClick={() => setSection(id)}
            >
              <Icon name={icon} />
              {label}
              {id === "queue" && <span>{pending.length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-demo">
          <span className="demo-star">✧</span>
          <b>Thử một chút phép màu</b>
          <p>
            Mọi trải nghiệm đều sẵn sàng,
            <br />
            kể cả khi bạn chưa lên LIVE.
          </p>
          <a href="/demo">
            Mở không gian demo <Icon name="arrow" size={15} />
          </a>
        </div>
        <div className="sidebar-bottom">
          <span className="local-dot" /> Chạy riêng trên máy của bạn
          <small>TIỆM TAROT / v1.0</small>
        </div>
      </aside>
      <div className="main-shell">
        <header className="app-header">
          <div>
            <span>Không gian sáng tạo</span>
            <Icon name="arrow" size={12} />
            <b>{navItems.find((x) => x[0] === section)?.[2]}</b>
          </div>
          <div className="header-right">
            <span
              className={`connection-chip ${connection.status === "connected" ? "connected" : ""}`}
            >
              <i />
              {connection.status === "connected"
                ? "Đã nối TikFinity"
                : "TikFinity chưa kết nối"}
            </span>
            <a href={`/overlay?mode=${mode}`} target="_blank" rel="noreferrer">
              Mở overlay <Icon name="external" size={14} />
            </a>
          </div>
        </header>
        <main>
          <div className="page-title">
            <div className="page-eyebrow">MỘT KHÔNG GIAN ĐỂ LẮNG NGHE</div>
            <div className="page-title-row">
              <div>
                <h1>
                  {section === "studio"
                    ? "Sẵn sàng cho những câu chuyện mới"
                    : navItems.find((x) => x[0] === section)?.[2]}
                </h1>
                <p>
                  {section === "studio"
                    ? "Kết nối cùng người xem, để mỗi lá bài mở ra một góc nhìn."
                    : "Cấu hình rõ ràng, vận hành nhẹ nhàng. Mọi thay đổi được lưu trên máy."}
                </p>
              </div>
              <div className="mode-switch">
                <button
                  className={mode === "live" ? "selected" : ""}
                  onClick={() => setMode("live")}
                >
                  <i /> LIVE
                </button>
                <button
                  className={mode === "demo" ? "selected" : ""}
                  onClick={() => setMode("demo")}
                >
                  ✧ DEMO
                </button>
              </div>
            </div>
          </div>
          {error && (
            <div className="error-banner" role="alert">
              {error}
              <button onClick={() => setError("")}>Đóng</button>
            </div>
          )}
          {mode === "demo" && (
            <div className="demo-banner">
              <span>✧</span>
              <div>
                <b>Bạn đang ở phiên DEMO</b>
                <span>
                  Dữ liệu thử tách riêng với LIVE. Không cần TikFinity hay API
                  key.
                </span>
              </div>
              <button
                onClick={() => action({ type: "demo", scenario: "full" })}
              >
                Chạy một lượt demo <Icon name="play" size={13} />
              </button>
            </div>
          )}
          {section === "studio" ? (
            <>
              <div className="stats-grid">
                <Stat
                  label="TRẠNG THÁI SÂN KHẤU"
                  value={
                    s.active
                      ? s.active.paused
                        ? "Đã tạm dừng"
                        : ["followup", "answer"].includes(s.active.phase)
                          ? "Đang hỏi đáp"
                          : "Đang xem bài"
                      : "Sẵn sàng đón khách"
                  }
                  icon="star"
                  detail={
                    s.active ? s.active.user.name : "Chưa có lượt đang đọc"
                  }
                  color="purple"
                />
                <Stat
                  label="HÀNG CHỜ XEM BÀI"
                  value={`${pending.length} người`}
                  icon="queue"
                  detail={`${ready.length} lượt đã đủ điều kiện`}
                  color="cyan"
                />
                <Stat
                  label="NĂNG LƯỢNG PHÒNG"
                  value={`${number(s.hearts.total)} tim`}
                  icon="heart"
                  detail={`Mốc tiếp theo: ${number((s.hearts.consumed ?? s.hearts.milestones * c.heartGoal) + c.heartGoal)} tim`}
                  color="pink"
                />
                <Stat
                  label="ĐÃ KẾT NỐI CÂU CHUYỆN"
                  value={`${s.queue.filter((q) => q.status === "completed").length} lượt`}
                  icon="moon"
                  detail={
                    mode === "demo"
                      ? "Trong phiên demo này"
                      : "Trong phiên LIVE này"
                  }
                  color="gold"
                />
              </div>
              <div className="studio-grid">
                <section className="preview-panel panel">
                  <div className="panel-header">
                    <h2>
                      <span className="dot-purple" /> Sân khấu trực tiếp
                    </h2>
                    <span className="dimension">9:16 · 1080 × 1920</span>
                  </div>
                  <div className="preview-surround">
                    <StageFrame state={state} guides={guides} />
                  </div>
                  <div className="preview-footer">
                    <label>
                      <input
                        type="checkbox"
                        checked={guides}
                        onChange={(e) => setGuides(e.target.checked)}
                      />{" "}
                      Vùng an toàn
                    </label>
                    <span>
                      <Icon name="sound" size={13} /> Preview tắt tiếng
                    </span>
                    <a
                      href={`/overlay?mode=${mode}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Icon name="external" size={14} />
                    </a>
                  </div>
                </section>
                <div className="control-column">
                  <section className="panel control-panel">
                    <div className="panel-header">
                      <h2>Điều hành phiên</h2>
                      <span className={`badge ${c.accepting ? "green" : ""}`}>
                        {c.accepting ? "Đang nhận lượt" : "Đã đóng nhận"}
                      </span>
                    </div>
                    <div className="current-reading">
                      {s.active ? (
                        <>
                          <div className="current-person">
                            <Avatar user={s.active.user} />
                            <div>
                              <strong>{s.active.user.name}</strong>
                              <span>
                                {s.active.topic} · {phases[s.active.phase]}
                              </span>
                            </div>
                          </div>
                          <p>{s.active.question}</p>
                          <div className="phase-dots">
                            {[
                              "locking",
                              "shuffling",
                              "dealing",
                              "card1",
                              "card2",
                              "card3",
                              "summary",
                              "followup",
                              "answer",
                              "complete",
                            ].map((p, i) => (
                              <i
                                key={p}
                                className={
                                  [
                                    "locking",
                                    "shuffling",
                                    "dealing",
                                    "card1",
                                    "card2",
                                    "card3",
                                    "summary",
                                    "followup",
                                    "answer",
                                    "complete",
                                  ].indexOf(s.active!.phase) >= i
                                    ? "filled"
                                    : ""
                                }
                              />
                            ))}
                          </div>
                        </>
                      ) : intakeItem ? (
                        <>
                          <div className="current-person">
                            <Avatar user={intakeItem.user} />
                            <div>
                              <strong>{intakeItem.user.name}</strong>
                              <span>{intakeItem.topicChosen ? `Chờ câu hỏi về ${intakeItem.topic.toLocaleLowerCase("vi")}` : "Đang chọn chủ đề trên overlay"}</span>
                            </div>
                          </div>
                          <p>Đến lượt người xem này. Tiệm đang nhận bình luận trực tiếp của họ trước khi xào bài.</p>
                        </>
                      ) : (
                        <div className="no-reading">
                          <span>☾</span>
                          <b>Sân khấu đang nghỉ một nhịp</b>
                          <p>Bắt đầu một lượt khi bạn sẵn sàng.</p>
                        </div>
                      )}
                    </div>
                    <div className="transport">
                      <button
                        className="primary"
                        onClick={() =>
                          action({
                            type: s.active
                              ? s.active.paused
                                ? "resume"
                                : "pause"
                              : "start",
                          })
                        }
                      >
                        <Icon
                          name={s.active && !s.active.paused ? "pause" : "play"}
                          size={16}
                        />
                        {s.active
                          ? s.active.paused
                            ? "Tiếp tục"
                            : "Tạm dừng"
                          : "Bắt đầu lượt"}
                      </button>
                      <button
                        title="Bỏ qua lượt hiện tại"
                        onClick={() => action(s.active ? { type: "skip" } : { type: "queue-skip", id: intakeItem?.id })}
                        disabled={!s.active && !intakeItem}
                      >
                        <Icon name="skip" size={18} />
                      </button>
                      <button
                        title="Đọc lại đoạn hiện tại"
                        onClick={() => action({ type: "replay" })}
                        disabled={!s.active || s.active.phase === "followup"}
                      >
                        <Icon name="reset" size={18} />
                      </button>
                    </div>
                    <div className="control-toggles">
                      <Toggle
                        label="Tự chuyển lượt tiếp theo"
                        hint="Sau tổng kết và phần hỏi đáp nếu bật"
                        checked={c.autoRun}
                        onChange={(v) => save({ autoRun: v })}
                      />
                      <Toggle
                        label="Mở nhận câu hỏi mới"
                        checked={c.accepting}
                        onChange={(v) => save({ accepting: v })}
                      />
                    </div>
                  </section>
                  {s.active && s.active.followUp && (
                    <FollowUpPanel key={s.active.id} reading={s.active} action={action} />
                  )}
                  {!s.active && lastFollowUp && (
                    <FollowUpPanel
                      reading={lastFollowUp}
                      action={action}
                    />
                  )}
                  <section className="panel queue-panel">
                    <div className="panel-header">
                      <h2>
                        Hàng chờ sắp tới{" "}
                        <span className="count-pill">{pending.length}</span>
                      </h2>
                      <button
                        className="text-button"
                        onClick={() => setSection("queue")}
                      >
                        Xem tất cả <Icon name="arrow" size={13} />
                      </button>
                    </div>
                    {pending.slice(0, 4).map((q, i) => (
                      <div className="compact-queue" key={q.id}>
                        <span className="muted">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <Avatar user={q.user} size={34} />
                        <div>
                          <b>{q.user.name}</b>
                          <small>{q.topic}</small>
                        </div>
                        <span
                          className={`badge ${q.status === "ready" ? "green" : ""}`}
                        >
                          {statuses[q.status]}
                        </span>
                      </div>
                    ))}
                    {!pending.length && (
                      <div className="empty-state">
                        <Icon name="queue" size={28} />
                        <p>Những câu chuyện mới sẽ xuất hiện ở đây.</p>
                      </div>
                    )}
                  </section>
                  <section className="audio-card">
                    <div className="audio-icon">
                      <Icon name="sound" size={23} />
                    </div>
                    <div>
                      <b>Nguồn phát âm thanh</b>
                      <p>{audio.status}</p>
                      <div className="audio-actions">
                        <button
                          onClick={audio.owner ? audio.disable : audio.enable}
                        >
                          {audio.owner ? "Tắt tiếng admin" : "Bật tiếng tại admin"}
                        </button>
                        <button
                          onClick={audio.test}
                          disabled={
                            audio.busy ||
                            audio.requesting ||
                            (!!state.audioOwner && !audio.owner)
                          }
                        >
                          Kiểm tra âm thanh
                        </button>
                      </div>
                      <p>
                        Để phát trên OBS/LIVE Studio, mở overlay và bật âm thanh
                        tại đó. Kiểm tra giọng ở admin chỉ phát tạm thời.
                      </p>
                    </div>
                  </section>
                  <div className="quiet-note">
                    <Icon name="check" size={14} />{" "}
                    {online ? "Đã đồng bộ với máy chủ" : "Đang nối lại máy chủ"}
                    <span>·</span> Mọi thay đổi được lưu tự động
                  </div>
                </div>
              </div>
              <DemoControls action={action} />
            </>
          ) : section === "queue" ? (
            <QueueView state={state} action={action} />
          ) : section === "rules" ? (
            <Rules key={mode} state={state} save={save} action={action} />
          ) : section === "appearance" ? (
            <Appearance key={mode} state={state} save={save} />
          ) : section === "audio" ? (
            <AudioSettings key={mode} state={state} save={save} audio={audio} />
          ) : (
            <ConnectionView state={state} action={action} save={save} />
          )}
        </main>
        <footer className="app-footer">
          <span>✧ Tiệm Tarot · Một góc nhìn, một sự kết nối</span>
          <span>Nội dung mang tính giải trí và tự chiêm nghiệm</span>
        </footer>
      </div>
      {toast && (
        <div className="toast">
          <Icon name="check" size={16} />
          {toast}
        </div>
      )}
    </div>
  );
}
function Stat({
  label,
  value,
  icon,
  detail,
  color,
}: {
  label: string;
  value: string;
  icon: string;
  detail: string;
  color: string;
}) {
  return (
    <div className={`stat-card ${color}`}>
      <div>
        <span>{label}</span>
        <Icon name={icon} size={20} />
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="toggle-row">
      <span>
        <b>{label}</b>
        {hint && <small>{hint}</small>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <i className="switch" />
    </label>
  );
}
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function FormPanel({
  title,
  description,
  children,
  onSave,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  onSave?: () => void;
}) {
  return (
    <section className="panel form-panel">
      <div className="form-heading">
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {children}
      {onSave && (
        <div className="form-actions">
          <button className="primary" onClick={onSave}>
            <Icon name="check" size={16} />
            Lưu thay đổi
          </button>
        </div>
      )}
    </section>
  );
}
function QueueView({
  state,
  action,
}: {
  state: Snapshot;
  action: (a: Action) => Promise<boolean>;
}) {
  const [filter, setFilter] = useState("pending");
  const [editing, setEditing] = useState("");
  const [question, setQuestion] = useState("");
  const [topic, setTopic] = useState<string>(TOPICS[0]);
  const q = state.session.queue.filter((x) =>
    filter === "all" || filter === "history"
      ? filter === "all" || ["completed", "skipped"].includes(x.status)
      : !["completed", "skipped"].includes(x.status),
  );
  return (
    <>
      <div className="section-toolbar">
        <div className="tab-buttons">
          {[
            ["pending", "Đang chờ"],
            ["history", "Lịch sử"],
            ["all", "Tất cả"],
          ].map(([k, v]) => (
            <button
              className={filter === k ? "selected" : ""}
              onClick={() => setFilter(k)}
              key={k}
            >
              {v}
            </button>
          ))}
        </div>
        <button
          className="danger-button"
          onClick={() => {
            if (
              window.confirm(
                "Bỏ qua toàn bộ lượt chưa đọc? Lịch sử và credit vẫn được giữ để đối soát.",
              )
            )
              action({ type: "clear-queue" });
          }}
        >
          Bỏ qua toàn bộ hàng chờ
        </button>
      </div>
      <div className="panel table-panel">
        <table>
          <thead>
            <tr>
              <th>NGƯỜI XEM</th>
              <th>CÂU HỎI</th>
              <th>QUÀ XÁC NHẬN</th>
              <th>TRẠNG THÁI</th>
              <th>THAO TÁC</th>
            </tr>
          </thead>
          <tbody>
            {q.map((item) => (
              <tr key={item.id}>
                <td>
                  <div className="table-user">
                    <Avatar user={item.user} size={36} />
                    <div>
                      <b>{item.user.name}</b>
                      <small>ID: {item.user.id}</small>
                    </div>
                  </div>
                </td>
                <td>
                  <span className="table-topic">{item.topic}</span>
                  <p className="table-question">
                    {item.question || "Chưa có câu hỏi"}
                  </p>
                  {editing === item.id && (
                    <div className="inline-editor">
                      <select
                        value={topic}
                        onChange={(e) => setTopic(e.target.value)}
                      >
                        {TOPICS.map((t) => (
                          <option key={t}>{t}</option>
                        ))}
                      </select>
                      <textarea
                        value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                        maxLength={state.config.maxQuestionLength}
                      />
                      <button
                        className="primary"
                        onClick={async () => {
                          if (
                            await action({
                              type: "queue-edit",
                              id: item.id,
                              question,
                              topic,
                            })
                          )
                            setEditing("");
                        }}
                      >
                        Lưu
                      </button>
                    </div>
                  )}
                </td>
                <td>
                  {number(item.coins)} xu
                  <small className="block">
                    {item.creditIds.length} credit áp dụng
                  </small>
                </td>
                <td>
                  <span
                    className={`badge ${item.status === "ready" ? "green" : ""}`}
                  >
                    {statuses[item.status]}
                  </span>
                </td>
                <td>
                  <div className="row-actions">
                    {!["reading", "completed", "skipped"].includes(
                      item.status,
                    ) && (
                      <>
                        <button
                          title="Sửa câu hỏi"
                          onClick={() => {
                            setEditing(editing === item.id ? "" : item.id);
                            setQuestion(item.question);
                            setTopic(item.topic);
                          }}
                        >
                          Sửa
                        </button>
                        <button
                          title="Duyệt thủ công điều kiện"
                          onClick={() =>
                            action({ type: "queue-approve", id: item.id })
                          }
                        >
                          Duyệt
                        </button>
                        <button
                          title="Di chuyển lên"
                          onClick={() =>
                            action({
                              type: "queue-move",
                              id: item.id,
                              direction: "up",
                            })
                          }
                        >
                          ↑
                        </button>
                        <button
                          title="Di chuyển xuống"
                          onClick={() =>
                            action({
                              type: "queue-move",
                              id: item.id,
                              direction: "down",
                            })
                          }
                        >
                          ↓
                        </button>
                        <button
                          onClick={() =>
                            action({ type: "queue-skip", id: item.id })
                          }
                        >
                          Bỏ qua
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!q.length && (
          <div className="empty-state">
            <Icon name="moon" size={32} />
            <p>Chưa có lượt trong danh sách này.</p>
          </div>
        )}
      </div>
      <CreditLedger state={state} action={action} />
    </>
  );
}
function Rules({
  state,
  save,
  action,
}: {
  state: Snapshot;
  save: (c: Partial<Config>) => void;
  action: (a: Action) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(state.config);
  const [map, setMap] = useState(
    JSON.stringify(state.config.giftValues, null, 2),
  );
  const [mapError, setMapError] = useState("");
  useEffect(() => {
    setDraft(state.config);
    setMap(JSON.stringify(state.config.giftValues, null, 2));
  }, [JSON.stringify(state.config)]);
  const set = (k: keyof Config, v: unknown) =>
    setDraft((d) => ({ ...d, [k]: v }));
  return (
    <div className="settings-grid">
      <FormPanel
        title="Cách người xem tham gia"
        description="Quy tắc mới áp dụng cho yêu cầu đang chờ và lượt kế tiếp. Lượt đã chốt giữ cấu hình riêng."
        onSave={() => {
          try {
            const value = JSON.parse(map);
            if (!value || Array.isArray(value) || typeof value !== "object")
              throw Error();
            save({
              joinMode: "gift_priority",
              giftValues: value,
              matchWindowSec: draft.matchWindowSec,
              cooldownSec: draft.cooldownSec,
              maxQuestionLength: draft.maxQuestionLength,
              priority: true,
              maxWaitSec: draft.maxWaitSec,
              moderation: draft.moderation,
            });
            setMapError("");
          } catch {
            setMapError('Bảng quy đổi phải là JSON dạng {"giftId": giá_xu}.');
          }
        }}
      >
        <div className="participation-guide">
          <strong>Tặng quà hoặc bình luận “tarot” để vào hàng</strong>
          <p>Người tặng quà được ưu tiên. Đến lượt, overlay gọi đúng tên và hỏi
            chủ đề, sau đó nhận câu hỏi cụ thể từ bình luận của người đó.</p>
          <span>Không cần cú pháp · Một lượt cho mỗi tài khoản</span>
        </div>
        <div className="form-grid">
          <NumberField
            label="Cửa sổ ghép (giây)"
            value={draft.matchWindowSec}
            onChange={(v) => set("matchWindowSec", v)}
            min={10}
          />
          <NumberField
            label="Cooldown mỗi người (giây)"
            value={draft.cooldownSec}
            onChange={(v) => set("cooldownSec", v)}
          />
          <NumberField
            label="Giới hạn câu hỏi (ký tự)"
            value={draft.maxQuestionLength}
            onChange={(v) => set("maxQuestionLength", v)}
            min={30}
            max={500}
          />
        </div>
        <NumberField
          label="Chờ tối đa trước khi được bảo vệ ưu tiên (giây)"
          value={draft.maxWaitSec}
          onChange={(v) => set("maxWaitSec", v)}
          min={30}
        />
        <Toggle
          label="Admin duyệt trước khi đọc"
          checked={draft.moderation}
          onChange={(v) => set("moderation", v)}
        />
        <Field
          label="Bảng quy đổi giftId → xu"
          hint="Chỉ điền giá trị đã xác minh. Giá trị xu không phải doanh thu tiền mặt."
        >
          <textarea
            rows={4}
            value={map}
            onChange={(e) => setMap(e.target.value)}
          />
        </Field>
        {mapError && <p className="form-error">{mapError}</p>}
      </FormPanel>
      <div>
        <FormPanel
          title="Tim & thông điệp chung"
          description="Mỗi mốc chỉ tạo một lượt; giữ phần dư và chờ ranh giới giữa các lượt cá nhân."
          onSave={() =>
            save({
              heartGoal: draft.heartGoal,
              communityCooldownSec: draft.communityCooldownSec,
              maxCommunityPending: draft.maxCommunityPending,
            })
          }
        >
          <NumberField
            label="Mốc tim mở lượt chung"
            value={draft.heartGoal}
            min={1}
            onChange={(v) => set("heartGoal", v)}
          />
          <NumberField
            label="Cooldown lượt chung (giây)"
            value={draft.communityCooldownSec}
            onChange={(v) => set("communityCooldownSec", v)}
          />
          <NumberField
            label="Số lượt chung chờ tối đa"
            value={draft.maxCommunityPending}
            min={1}
            max={5}
            onChange={(v) => set("maxCommunityPending", v)}
          />
        </FormPanel>
        <ConfigTransfer state={state} action={action} />
        <FormPanel
          title="Bắt đầu phiên mới"
          description="Lưu lịch sử phiên trước; đặt lại baseline tim và dấu sự kiện cho phòng/phiên mới."
        >
          <button
            onClick={() => {
              if (
                confirm(
                  "Bắt đầu phiên mới? Lượt đang đọc cần hoàn tất hoặc bỏ qua trước.",
                )
              )
                action({ type: "new-session" });
            }}
          >
            Bắt đầu phiên mới
          </button>
        </FormPanel>
      </div>
    </div>
  );
}
function NumberField({
  label,
  value,
  onChange,
  min = 0,
  max = 999999,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
      />
    </Field>
  );
}
function Appearance({
  state,
  save,
}: {
  state: Snapshot;
  save: (c: Partial<Config>) => void;
}) {
  const [d, setD] = useState(state.config);
  const set = (k: keyof Config, v: unknown) => setD((p) => ({ ...p, [k]: v }));
  const [assetJson, setAssetJson] = useState(
    JSON.stringify(d.cardAssets, null, 2),
  );
  const [error, setError] = useState("");
  useEffect(() => {
    setD(state.config);
    setAssetJson(JSON.stringify(state.config.cardAssets, null, 2));
  }, [JSON.stringify(state.config)]);
  return (
    <div className="settings-grid">
      <FormPanel
        title="Dấu ấn của tiệm"
        description="Màu và cỡ chữ được cập nhật ngay khi lưu. Sân khấu luôn giữ tỷ lệ 9:16."
        onSave={() =>
          save({
            shopName: d.shopName,
            instruction: d.instruction,
            footer: d.footer,
            accent: d.accent,
            cyan: d.cyan,
            fontScale: d.fontScale,
            safeTop: d.safeTop,
            safeBottom: d.safeBottom,
            safeX: d.safeX,
            reducedMotion: d.reducedMotion,
            fps: d.fps,
          })
        }
      >
        <Field label="Tên tiệm">
          <input
            value={d.shopName}
            maxLength={40}
            onChange={(e) => set("shopName", e.target.value)}
          />
        </Field>
        <Field
          label="Hướng dẫn đầu màn hình"
          hint="Dùng {heartGoal} để mốc tim tự cập nhật. Người xem tham gia bằng quà hoặc bình luận tarot."
        >
          <input
            value={d.instruction}
            maxLength={110}
            onChange={(e) => set("instruction", e.target.value)}
          />
        </Field>
        <Field label="Hướng dẫn cuối màn hình">
          <textarea
            value={d.footer}
            maxLength={160}
            onChange={(e) => set("footer", e.target.value)}
          />
        </Field>
        <div className="form-grid">
          <Field label="Màu hồng / tím">
            <input
              type="color"
              value={d.accent}
              onChange={(e) => set("accent", e.target.value)}
            />
          </Field>
          <Field label="Màu cyan">
            <input
              type="color"
              value={d.cyan}
              onChange={(e) => set("cyan", e.target.value)}
            />
          </Field>
          <NumberField
            label="Tỷ lệ chữ (0,9–1,15)"
            value={d.fontScale}
            min={0.9}
            max={1.15}
            step={0.05}
            onChange={(v) => set("fontScale", v)}
          />
          <Field label="Mục tiêu hiệu ứng">
            <select value={d.fps} onChange={(e) => set("fps", +e.target.value)}>
              <option value={30}>30 FPS · nhẹ</option>
              <option value={60}>60 FPS</option>
            </select>
          </Field>
          <NumberField
            label="Safe margin trên (px)"
            value={d.safeTop}
            max={80}
            onChange={(v) => set("safeTop", v)}
          />
          <NumberField
            label="Safe margin dưới (px)"
            value={d.safeBottom}
            max={100}
            onChange={(v) => set("safeBottom", v)}
          />
          <NumberField
            label="Safe margin hai bên (px)"
            value={d.safeX}
            min={20}
            max={80}
            onChange={(v) => set("safeX", v)}
          />
        </div>
        <Toggle
          label="Giảm chuyển động"
          hint="Tắt chuyển động nền, nhân vật và hạt sáng"
          checked={d.reducedMotion}
          onChange={(v) => set("reducedMotion", v)}
        />
      </FormPanel>
      <FormPanel
        title="Nhân vật & bộ bài"
        description="Đặt file trong public/custom rồi nhập /custom/ten-file.png. Ảnh/video được phục vụ local; hỗ trợ PNG, SVG, JPG, WebP và video MP4/WebM."
        onSave={() => {
          try {
            const cardAssets = JSON.parse(assetJson);
            save({
              characterAsset: d.characterAsset,
              backgroundAsset: d.backgroundAsset,
              cardBackAsset: d.cardBackAsset,
              cardAssets,
            });
            setError("");
          } catch {
            setError("Bảng ảnh bài phải là JSON hợp lệ.");
          }
        }}
      >
        <div className="asset-preview">
          {/\.(mp4|webm)(\?|$)/i.test(d.characterAsset) ? (
            <video src={d.characterAsset} autoPlay loop muted playsInline />
          ) : (
            <img
              src={d.characterAsset || "/assets/tarot-reader.png"}
              alt="Nhân vật hiện tại"
              onError={(e) => {
                e.currentTarget.src = "/assets/tarot-reader.png";
              }}
            />
          )}
        </div>
        <Field label="Ảnh / video nhân vật">
          <input
            value={d.characterAsset}
            onChange={(e) => set("characterAsset", e.target.value)}
          />
        </Field>
        <Field label="Ảnh nền (để trống dùng nền mặc định)">
          <input
            value={d.backgroundAsset}
            onChange={(e) => set("backgroundAsset", e.target.value)}
          />
        </Field>
        <Field label="Mặt sau bài">
          <input
            value={d.cardBackAsset}
            onChange={(e) => set("cardBackAsset", e.target.value)}
          />
        </Field>
        <Field
          label="Ảnh riêng từng lá: cardId → đường dẫn"
          hint="Xem danh sách cardId trong shared/cards.ts trong bộ mã nguồn."
        >
          <textarea
            value={assetJson}
            onChange={(e) => setAssetJson(e.target.value)}
            rows={6}
          />
        </Field>
        {error && <p className="form-error">{error}</p>}
        <div className="info-note">
          ✧ Nhân vật được tạo riêng bằng AI. Bộ 78 lá Rider–Waite–Smith được lưu
          local, giữ nguyên hình toàn lá. Có thể thay bằng artwork của bạn.
        </div>
      </FormPanel>
    </div>
  );
}
function AudioSettings({
  state,
  save,
  audio,
}: {
  state: Snapshot;
  save: (c: Partial<Config>) => void;
  audio: ReturnType<typeof useAudio>;
}) {
  const [d, setD] = useState(state.config);
  useEffect(() => setD(state.config), [JSON.stringify(state.config)]);
  const set = (k: keyof Config, v: unknown) => setD((p) => ({ ...p, [k]: v }));
  const audioTestDisabled =
    audio.busy || audio.requesting || (!!state.audioOwner && !audio.owner);
  return (
    <div className="settings-grid">
      <FormPanel
        title="Giọng đọc tiếng Việt"
        description="Bật âm thanh trên overlay dùng làm nguồn phát OBS/LIVE Studio. Kiểm tra giọng tại admin chỉ phát tạm thời rồi trả quyền âm thanh."
        onSave={() =>
          save({
            ttsProvider: d.ttsProvider,
            voice: d.voice,
            speechRate: d.speechRate,
            speechVolume: d.speechVolume,
            music: d.music,
            musicVolume: d.musicVolume,
            sfx: d.sfx,
            sfxVolume: d.sfxVolume,
          })
        }
      >
        <Field label="Nguồn giọng đọc">
          <select
            value={d.ttsProvider}
            onChange={(e) => set("ttsProvider", e.target.value)}
          >
            <option value="browser">Giọng hệ thống / trình duyệt</option>
            <option value="http">
              Dịch vụ TTS HTTP (cấu hình backend/.env)
            </option>
            <option value="off">Chỉ hiển thị chữ</option>
          </select>
        </Field>
        <Field label={`Giọng Việt khả dụng (${audio.vi.length})`}>
          <select
            value={d.voice}
            onChange={(e) => set("voice", e.target.value)}
          >
            <option value="">Tự chọn giọng Việt</option>
            {audio.vi.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {v.name} · {v.lang}
              </option>
            ))}
          </select>
        </Field>
        <div className="form-grid">
          <NumberField
            label="Tốc độ đọc"
            value={d.speechRate}
            min={0.5}
            max={1.5}
            step={0.05}
            onChange={(v) => set("speechRate", v)}
          />
          <NumberField
            label="Âm lượng giọng (0–1)"
            value={d.speechVolume}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => set("speechVolume", v)}
          />
        </div>
        <Toggle
          label="Nhạc nền tarot nhẹ"
          hint="Hòa âm êm và tiếng dây gảy thưa; tự hạ nhỏ khi có lời đọc"
          checked={d.music}
          onChange={(v) => set("music", v)}
        />
        <NumberField
          label="Âm lượng nhạc nền (0–0,5)"
          value={d.musicVolume}
          min={0}
          max={0.5}
          step={0.05}
          onChange={(v) => set("musicVolume", v)}
        />
        <Toggle
          label="Âm thanh xào / chia / lật bài"
          checked={d.sfx}
          onChange={(v) => set("sfx", v)}
        />
        <NumberField
          label="Âm lượng xào / lật bài (0–1)"
          value={d.sfxVolume}
          min={0}
          max={1}
          step={0.05}
          onChange={(v) => set("sfxVolume", v)}
        />
        <div className="button-row">
          <button onClick={audio.testShuffle} disabled={audioTestDisabled}>
            Nghe thử xào bài
          </button>
          <button onClick={audio.testMusic} disabled={audioTestDisabled}>
            Nghe thử nhạc nền
          </button>
        </div>
        <div className="info-note">
          {audio.status}
          <br />
          {state.audioOwner
            ? "Đã có một tab sở hữu âm thanh."
            : "Chưa có tab phát âm thanh."}
        </div>
        <div className="button-row">
          <button onClick={audio.owner ? audio.disable : audio.enable}>
            {audio.owner ? "Tắt tiếng admin" : "Bật tiếng tại admin"}
          </button>
          <button
            onClick={audio.test}
            disabled={audioTestDisabled}
          >
            Kiểm tra âm thanh
          </button>
        </div>
      </FormPanel>
      <div>
        <FormPanel
          title="Lời giải & AI tùy chọn"
          description="Không có key vẫn chạy đầy đủ bằng dữ liệu biên soạn. AI chỉ diễn giải ba lá server đã chốt."
          onSave={() =>
            save({
              aiEnabled: d.aiEnabled,
              aiModel: d.aiModel,
              aiTimeoutSec: d.aiTimeoutSec,
              displayWords: d.displayWords,
              summaryWords: d.summaryWords,
              reversed: d.reversed,
            })
          }
        >
          <Toggle
            label="Dùng AI cá nhân hóa"
            hint={
              state.capabilities.ai
                ? "Backend đã có cấu hình key"
                : "Chưa cấu hình AI_API_KEY trong backend/.env"
            }
            checked={d.aiEnabled}
            onChange={(v) => set("aiEnabled", v)}
          />
          <Field label="Model theo dịch vụ đã cấu hình">
            <input
              value={d.aiModel}
              placeholder="Tên model được nhà cung cấp hỗ trợ"
              onChange={(e) => set("aiModel", e.target.value)}
            />
          </Field>
          <NumberField
            label="Timeout AI (giây)"
            value={d.aiTimeoutSec}
            min={2}
            max={60}
            onChange={(v) => set("aiTimeoutSec", v)}
          />
          <div className="form-grid">
            <NumberField
              label="Tối đa số từ mỗi lá"
              value={d.displayWords}
              min={45}
              max={70}
              onChange={(v) => set("displayWords", v)}
            />
            <NumberField
              label="Tối đa số từ tổng kết"
              value={d.summaryWords}
              min={35}
              max={55}
              onChange={(v) => set("summaryWords", v)}
            />
          </div>
          <Toggle
            label="Cho phép bài ngược"
            checked={d.reversed}
            onChange={(v) => set("reversed", v)}
          />
          <div className="info-note">
            Key chỉ lưu tại backend/.env, không nhập vào trình duyệt. Nguồn lời
            giải của lượt hiện tại:{" "}
            <b>
              {state.aiPending
                ? "Đang tạo lời giải AI…"
                : !state.session.active
                ? "Chưa có lượt đang đọc"
                : state.session.active.content.source === "ai"
                  ? "AI cá nhân hóa"
                  : "Dữ liệu biên soạn / fallback"}
            </b>
            {state.session.active?.content.error && (
              <p>{state.session.active.content.error}</p>
            )}
            {state.session.active && !state.aiPending && (
              <p>
                Lượt bắt đầu lúc{" "}
                {new Date(state.session.active.createdAt).toLocaleTimeString("vi-VN", {
                  timeZone: "Asia/Saigon",
                })}
                . Lời giải đã chốt được giữ nguyên; cấu hình AI mới áp dụng cho
                lượt tiếp theo.
              </p>
            )}
          </div>
        </FormPanel>
        <FormPanel
          title="Hỏi đáp sau trải bài"
          description="Người vừa xem được hỏi thêm ba câu bằng bình luận thường. Mỗi câu có 30 giây để hỏi; đồng hồ mới bắt đầu sau khi đọc xong câu trả lời trước."
          onSave={() => save({
            followUpEnabled: d.followUpEnabled,
            followUpWindowSec: 30,
          })}
        >
          <Toggle
            label="Cho phép hỏi tiếp sau tổng kết"
            hint="Nhận bình luận trực tiếp từ đúng người vừa xem · Mỗi câu có 30 giây"
            checked={d.followUpEnabled}
            onChange={(value) => set("followUpEnabled", value)}
          />
        </FormPanel>
        <FormPanel
          title="Nhịp chuyển sân khấu"
          description="Thời gian tính bằng giây. Giữ nội dung đủ lâu để đọc; cấu hình mới áp dụng từ lượt kế tiếp."
          onSave={() => save({ durations: d.durations })}
        >
          <div className="form-grid">
            {(
              [
                ["locking", "Chốt yêu cầu"],
                ["shuffling", "Xào bài"],
                ["dealing", "Chia bài"],
                ["card", "Mỗi lá bài"],
                ["summary", "Tổng kết"],
                ["complete", "Giữ sau hoàn tất"],
              ] as const
            ).map(([k, label]) => (
              <NumberField
                key={k}
                label={label}
                value={d.durations[k]}
                min={1}
                max={180}
                onChange={(v) => set("durations", { ...d.durations, [k]: v })}
              />
            ))}
          </div>
        </FormPanel>
      </div>
    </div>
  );
}
function DemoControls({ action }: { action: (a: Action) => Promise<boolean> }) {
  return (
    <section className="panel demo-tools">
      <div className="form-heading">
        <h2>
          Phòng thử nghiệm <span className="badge">DEMO</span>
        </h2>
        <p>
          Sự kiện mẫu đi qua cùng adapter và hàng chờ như LIVE; luôn đưa vào
          phiên demo.
        </p>
      </div>
      <div className="scenario-grid">
        {[
          ["seed", "queue", "10 người · trùng nickname"],
          ["gift-first", "gift", "Quà trước câu hỏi"],
          ["question-first", "log", "Câu hỏi trước quà"],
          ["combo", "gift", "Combo 1 → 2 → 3 + lặp"],
          ["hearts", "heart", "Tim vượt mốc"],
          ["ai-timeout", "star", "Giả lập AI timeout"],
          ["tts-error", "sound", "Giả lập TTS lỗi"],
          ["disconnect", "link", "Mất kết nối"],
          ["reconnect", "reset", "Nối lại"],
          ["next-phase", "skip", "Chuyển nhanh bước demo"],
        ].map(([id, icon, label]) => (
          <button
            key={id}
            onClick={() =>
              action(
                id === "next-phase"
                  ? { type: "next-phase" }
                  : { type: "demo", scenario: id },
              )
            }
          >
            <Icon name={icon} size={17} />
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}
function ConnectionView({
  state,
  action,
  save,
}: {
  state: Snapshot;
  action: (a: Action) => Promise<boolean>;
  save: (c: Partial<Config>) => void;
}) {
  const [url, setUrl] = useState(state.connection.url);
  const [raw, setRaw] = useState(
    '{"event":"chat","data":{"userId":"demo-custom","nickname":"Người thử","msgId":"test-1","comment":"tarot tình duyên, Tôi và người ấy có thể đi đường dài không?"}}',
  );
  const [rawError, setRawError] = useState("");
  return (
    <>
      <div className="settings-grid">
        <FormPanel
          title="TikFinity Desktop"
          description="Backend là nơi duy nhất kết nối Event API. TikFinity cần chạy cùng máy với ứng dụng."
        >
          <div className="connection-status-large">
            <i
              className={
                state.connection.status === "connected"
                  ? "green-dot"
                  : "gray-dot"
              }
            />
            <div>
              <b>
                {state.connection.status === "connected"
                  ? "Đã nối TikFinity"
                  : state.connection.status === "connecting"
                    ? "Đang kết nối…"
                    : "Chưa kết nối TikFinity"}
              </b>
              <p>
                {state.connection.lastEventAt
                  ? `Đã nhận sự kiện LIVE · ${time(state.connection.lastEventAt)}`
                  : "Chưa nhận sự kiện LIVE"}
              </p>
            </div>
          </div>
          <Field label="WebSocket Event API">
            <input value={url} onChange={(e) => setUrl(e.target.value)} />
          </Field>
          <div className="button-row">
            <button
              className="primary"
              onClick={() => action({ type: "connection-config", url })}
            >
              <Icon name="reset" size={15} /> Lưu URL & nối lại
            </button>
          </div>
          <div className="info-note">
            {state.connection.lastError ||
              "Mở TikFinity, kết nối tài khoản LIVE và kiểm tra Event API."}
            <br />
            Số lần nối lại: {state.connection.attempts}
          </div>
          <p className="muted">
            roomUser chỉ được ghi nhận như thông tin thống kê, không tạo người
            xem hoặc lượt tarot.
          </p>
        </FormPanel>
        <FormPanel
          title="Gửi payload kiểm tra"
          description="Chỉ gửi vào DEMO. Không trộn dữ liệu thử vào phiên LIVE."
        >
          <Field label="Envelope TikFinity {event, data}">
            <textarea
              rows={6}
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
            />
          </Field>
          <button
            onClick={() => {
              try {
                action({ type: "demo", envelope: JSON.parse(raw) });
                setRawError("");
              } catch {
                setRawError("JSON chưa hợp lệ");
              }
            }}
          >
            Gửi sự kiện mẫu
          </button>
          {rawError && <p className="form-error">{rawError}</p>}
        </FormPanel>
      </div>
      <section className="panel event-panel">
        <div className="panel-header">
          <h2>Sự kiện gần nhất</h2>
          <span className="muted">Tối đa 100 bản ghi · không chứa secret</span>
        </div>
        <div className="event-list">
          {state.session.logs.map((log) => (
            <div className="event-row" key={log.id}>
              <span>{time(log.at)}</span>
              <code>{log.event}</code>
              <span
                className={`badge ${/applied|accepted|ready|ok|normalized/.test(log.status) ? "green" : ""}`}
              >
                {log.status}
              </span>
              <p>{log.detail}</p>
              <small>{log.source.toUpperCase()}</small>
            </div>
          ))}
          {!state.session.logs.length && (
            <div className="empty-state">
              <p>
                Chưa có sự kiện. LIVE mất kết nối sẽ giữ nguyên trạng thái thật.
              </p>
            </div>
          )}
        </div>
      </section>
      <DemoControls action={action} />
    </>
  );
}
function ConfigTransfer({
  state,
  action,
}: {
  state: Snapshot;
  action: (a: Action) => Promise<boolean>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  return (
    <FormPanel
      title="Sao lưu cấu hình"
      description="Chỉ xuất các trường cấu hình công khai. File không chứa API key, credit hay dữ liệu người xem."
    >
      <div className="button-row">
        <button
          onClick={() => {
            const blob = new Blob([JSON.stringify(state.config, null, 2)], {
              type: "application/json",
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "tiem-tarot-config.json";
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          <Icon name="download" size={16} /> Xuất cấu hình
        </button>
        <button onClick={() => input.current?.click()}>Nhập cấu hình</button>
        <input
          type="file"
          hidden
          ref={input}
          accept="application/json,.json"
          onChange={async (e) => {
            try {
              const file = e.target.files?.[0];
              if (!file) return;
              if (file.size > 100_000) throw Error("File quá lớn");
              const config = JSON.parse(await file.text());
              if (await action({ type: "config", config })) setError("");
              else setError("Máy chủ từ chối cấu hình.");
            } catch {
              setError("Không đọc được cấu hình JSON.");
            }
            if (input.current) input.current.value = "";
          }}
        />
      </div>
      {error && <p className="form-error">{error}</p>}
    </FormPanel>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
