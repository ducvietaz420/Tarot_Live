import { TOPICS, type QueueItem, type Reading } from "../shared/types";

export default function ViewerPrompt({
  intake,
  reading,
  seconds,
}: {
  intake?: QueueItem;
  reading?: Reading;
  seconds: number;
}) {
  const name = intake?.user.name || reading?.user.name || "bạn";
  const asked = reading?.followUp?.questions.length || 0;
  const questionNumber = Math.min(3, asked + 1);
  const chosenTopic = !!intake?.topicChosen;
  const examples = {
    "Tình duyên": "Tôi và người ấy có thể cùng nhau đi đường dài không?",
    "Tiền bạc": "Tôi nên chú ý điều gì để quản lý tiền tốt hơn?",
    "Công việc": "Tôi có nên theo đuổi cơ hội công việc mới này không?",
    "Học hành": "Tôi nên tập trung vào đâu để việc học tiến bộ hơn?",
    "Gia đình": "Tôi nên làm gì để gần gũi và thấu hiểu gia đình hơn?",
  };
  return (
    <div className={`viewer-prompt ${intake ? "intake-prompt" : "followup-prompt"}`}>
      <div className="prompt-eyebrow">✦ {intake ? "ĐẾN LƯỢT CÂU CHUYỆN CỦA BẠN" : `HỎI THÊM VỀ TRẢI BÀI · CÂU ${questionNumber}/3`} ✦</div>
      <h2>Xin chào, <strong title={name}>{name}</strong><span>♡</span></h2>
      {intake ? (
        <>
          <p className="prompt-question">{chosenTopic
            ? <>Về <strong>{intake.topic.toLocaleLowerCase("vi")}</strong>, điều gì đang khiến bạn băn khoăn nhất?</>
            : "Hôm nay, bạn muốn những lá bài lắng nghe câu chuyện nào?"}</p>
          {chosenTopic ? (
            <p className="prompt-example">Chia sẻ câu hỏi cụ thể trong bình luận nhé.<br />Ví dụ: “{examples[intake.topic]}”</p>
          ) : (
            <div className="prompt-topics">{TOPICS.map((topic, index) => (
              <span key={topic}>{["♡", "✦", "♧", "✎", "⌂"][index]} {topic}</span>
            ))}</div>
          )}
          <div className="prompt-footer"><i />Còn {seconds} giây · {chosenTopic ? "Bình luận câu hỏi cụ thể, tiệm đang lắng nghe." : "Bình luận chủ đề và điều bạn muốn biết nhé."}<i /></div>
          <div className="prompt-timer-track" role="progressbar" aria-label="Thời gian chờ câu hỏi" aria-valuemin={0} aria-valuemax={60} aria-valuenow={Math.max(0, Math.min(60, seconds))}>
            <i style={{ width: `${Math.max(0, Math.min(100, seconds / 60 * 100))}%` }} />
          </div>
        </>
      ) : (
        <>
          <p className="prompt-question">Bạn có <strong>3 câu hỏi</strong> để hiểu thêm về ba lá vừa mở.<br />Mỗi câu có <strong>30 giây</strong> để đặt câu hỏi.</p>
          <div className={`prompt-clock ${seconds <= 10 ? "is-ending" : ""}`}>
            <strong>{String(seconds).padStart(2, "0")}<small>giây</small></strong>
            <div><span>ĐANG CHỜ CÂU {questionNumber} CỦA {name}</span><b>Viết thẳng câu hỏi trong bình luận nhé.</b></div>
          </div>
          <div className="prompt-timer-track" role="progressbar" aria-label="Thời gian đặt câu hỏi tiếp" aria-valuemin={0} aria-valuemax={30} aria-valuenow={Math.max(0, Math.min(30, seconds))}>
            <i style={{ width: `${Math.max(0, Math.min(100, seconds / 30 * 100))}%` }} />
          </div>
        </>
      )}
    </div>
  );
}
