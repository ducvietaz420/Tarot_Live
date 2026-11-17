import type { CSSProperties } from "react";

const picks = [5, 12, 19];

/** A whole deck is shuffled first; three cards then leave the opened fan. */
export default function DeckRitual({
  phase,
  back,
}: {
  phase: "shuffling" | "dealing";
  back: string;
}) {
  return (
    <div className={`deck-ritual ritual-${phase}`} role="img"
      aria-label={phase === "shuffling"
        ? "Hai nửa bộ bài được xào xen kẽ rồi gom lại"
        : "Bộ bài xòe thành vòng cung, ba lá lần lượt được chọn ra"}>
      <div className="ritual-table-glow" />
      {Array.from({ length: 24 }, (_, index) => {
        const spread = (index - 11.5) / 11.5;
        const pick = picks.indexOf(index);
        return (
          <div key={index}
            className={`ritual-card ${pick >= 0 ? `ritual-picked pick-${pick}` : ""}`}
            style={{
              "--side": index % 2 ? 1 : -1,
              "--depth": Math.floor(index / 2),
              "--fan-x": `${spread * 290}px`,
              "--fan-y": `${Math.abs(spread) * 72 + 8}px`,
              "--fan-angle": `${spread * 36}deg`,
              "--selected-x": `${(pick - 1) * 227}px`,
              zIndex: pick >= 0 && phase === "dealing" ? 40 + pick : index + 1,
            } as CSSProperties}>
            <img src={back} alt="" onError={(event) => {
              event.currentTarget.src = "/assets/card-back.svg";
            }} />
          </div>
        );
      })}
      <p className="ritual-note">{phase === "shuffling"
        ? "Xào nhẹ bộ bài · Kết nối với câu chuyện của bạn"
        : "Xòe bộ bài · Chọn ba thông điệp dành riêng cho bạn"}</p>
    </div>
  );
}
