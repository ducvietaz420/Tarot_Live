import { useEffect, useState, type FormEvent } from "react";
import type { Action, Reading } from "../shared/types";

const labels = {
  queued: "Đang chờ",
  generating: "AI đang trả lời…",
  answered: "Đã trả lời",
  failed: "Chưa trả lời được",
};

export default function FollowUpPanel({
  reading,
  action,
}: {
  reading: Reading;
  action: (action: Action) => Promise<boolean>;
}) {
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    setQuestion("");
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [reading.id]);
  const session = reading.followUp;
  if (!session) return null;
  const history = !["followup", "answer"].includes(reading.phase);
  const seconds = Math.max(0, Math.ceil((session.deadline - now) / 1000));
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const waiting = !!session.awaitingQuestion && session.deadline > 0;
  const closed = history || !!session.closedReason || (waiting && seconds === 0);
  const canAsk = !closed && !reading.paused && waiting && session.questions.length < 3;
  const perform = async (payload: Action) => {
    if (sending) return false;
    setSending(true);
    try { return await action(payload); }
    finally { setSending(false); }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canAsk || sending || question.trim().length < 8) return;
    if (await perform({
      type: "followup-ask",
      readingId: reading.id,
      userId: reading.user.id,
      question: question.trim(),
    })) setQuestion("");
  };
  return (
    <section className="panel followup-panel" aria-label="Hỏi đáp sau trải bài">
      <div className="panel-header">
        <h2>{history ? "Hỏi đáp vừa hoàn tất" : "Hỏi thêm về ba lá vừa mở"}</h2>
        <span className="badge">{session.questions.length}/3 câu</span>
      </div>
      <div className="followup-intro">
        <strong>Dành cho {reading.user.name}</strong>
        <span className={waiting && seconds <= 10 ? "followup-countdown is-ending" : "followup-countdown"}>
          {closed ? "Đã kết thúc" : waiting ? `${clock} để đặt câu hỏi` : "Đang giải đáp"}
        </span>
        <p>
          {history
            ? "Các câu trả lời dưới đây dựa trên ba lá và lời giải của người này."
            : waiting && !closed
              ? <>Đang chờ {reading.user.name} bình luận trực tiếp câu hỏi tiếp theo;
                còn {clock}. Mỗi câu có 30 giây để hỏi.</>
              : <>Tiệm đang trả lời dựa trên đúng ba lá vừa mở.
                Khi đọc xong, người xem sẽ có 30 giây cho câu tiếp theo.</>}
        </p>
      </div>
      <ol className="followup-list">
        {Array.from({ length: history ? session.questions.length : 3 }, (_, index) => {
          const item = session.questions[index];
          if (!item) return (
            <li key={`empty-${index}`} className="followup-item available">
              <div className="followup-item-heading">
                <strong>Câu {index + 1}</strong>
                <span>Chưa hỏi</span>
              </div>
            </li>
          );
          const retrySeconds = Math.max(0, Math.ceil((5000 - (now - (item.answeredAt || item.askedAt))) / 1000));
          return <li key={item.id} className={`followup-item ${item.status}`}>
            <div className="followup-item-heading">
              <strong>Câu {index + 1}</strong>
              <span>{labels[item.status]}</span>
            </div>
            <p className="followup-question">{item.question}</p>
            {item.answer && <p className="followup-answer">{item.answer}</p>}
            {item.error && <p className="form-error">{item.error}</p>}
            {item.status === "failed" && (
              <button
                type="button"
                disabled={closed || reading.paused || sending || retrySeconds > 0 || (item.attempts || 0) >= 3}
                onClick={() => void perform({
                  type: "followup-retry",
                  readingId: reading.id,
                  id: item.id,
                })}
              >
                {retrySeconds > 0 ? `Thử lại sau ${retrySeconds} giây` : `Thử trả lời lại câu ${index + 1}`}
              </button>
            )}
          </li>;
        })}
      </ol>
      {session.questions.length === 0 && (
        <p className="followup-empty">{history ? "Không có câu hỏi tiếp trong lượt này." : "Chưa có câu hỏi nào được gửi."}</p>
      )}
      {!history && <form className="followup-form" onSubmit={(event) => void submit(event)}>
        <label htmlFor={`followup-question-${reading.id}`}>Nhập giúp câu hỏi của {reading.user.name}</label>
        <textarea
          id={`followup-question-${reading.id}`}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ví dụ: Tôi nên làm gì trước trong tình huống này?"
          maxLength={500}
          rows={3}
          disabled={!canAsk || sending}
        />
        <div className="followup-form-footer">
          <small>{closed ? "Thời gian hỏi đáp đã kết thúc." : reading.paused ? "Tiếp tục lượt để nhận câu hỏi." : session.questions.length >= 3 ? "Đã nhận đủ ba câu hỏi." : !waiting ? "Đọc xong câu trả lời sẽ mở 30 giây cho câu tiếp theo." : "Từ 8 đến 500 ký tự · Bình luận trực tiếp."}</small>
          <button className="primary" type="submit" disabled={!canAsk || sending || question.trim().length < 8}>
            {sending ? "Đang gửi…" : "Gửi câu hỏi"}
          </button>
        </div>
      </form>}
      {!history && <div className="followup-end">
        <button
          type="button"
          disabled={closed || sending}
          onClick={() => void perform({ type: "followup-end", readingId: reading.id })}
        >
          Kết thúc hỏi đáp sớm
        </button>
      </div>}
    </section>
  );
}
