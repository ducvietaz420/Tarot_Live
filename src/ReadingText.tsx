import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { sentenceRanges } from "../shared/text";

/** Text stays as one paragraph; only its focus/scroll position follows narration. */
export function ReadingText({
  text,
  charIndex,
  tracking,
  paused,
  reducedMotion,
  phaseKey,
  label = "Lời giải đầy đủ",
}: {
  text: string;
  charIndex: number;
  tracking: boolean;
  paused: boolean;
  reducedMotion: boolean;
  phaseKey: string;
  label?: string;
}) {
  const view = useRef<HTMLDivElement>(null);
  const ranges = useMemo(() => sentenceRanges(text), [text]);
  const activeIndex = Math.max(
    0,
    ranges.findIndex((range) => charIndex < range.end),
  );
  useLayoutEffect(() => {
    if (view.current) view.current.scrollTop = 0;
  }, [phaseKey, text]);
  useEffect(() => {
    const element = view.current;
    if (
      !element ||
      paused ||
      !tracking ||
      element.scrollHeight <= element.clientHeight + 1
    )
      return;
    const sentence = element.querySelector<HTMLElement>(
      `[data-sentence="${activeIndex}"]`,
    );
    const range = ranges[activeIndex];
    if (!sentence || !range) return;
    const rect = sentence.getBoundingClientRect(),
      box = element.getBoundingClientRect();
    const scale = box.height / element.clientHeight || 1;
    const top = (rect.top - box.top) / scale + element.scrollTop;
    const fraction = Math.max(
      0,
      Math.min(
        1,
        (charIndex - range.start) / Math.max(1, range.end - range.start),
      ),
    );
    const height = rect.height / scale;
    const point =
      top +
      (height > element.clientHeight * 0.7 ? fraction * height : height * 0.35);
    const target = Math.max(
      0,
      Math.min(
        element.scrollHeight - element.clientHeight,
        point - element.clientHeight * 0.48,
      ),
    );
    if (Math.abs(element.scrollTop - target) > 3)
      element.scrollTo({
        top: target,
        behavior: reducedMotion ? "instant" : "smooth",
      });
  }, [activeIndex, charIndex, tracking, paused, reducedMotion, ranges]);
  return (
    <div className="reading-copy" ref={view} tabIndex={0} aria-label={label}>
      <p>
        {ranges.map((range, index) => (
          <span key={range.start}>
            {text.slice(index ? ranges[index - 1].end : 0, range.start)}
            <span
              data-sentence={index}
              className={
                tracking && index === activeIndex
                  ? "current-sentence"
                  : undefined
              }
            >
              {range.text}
            </span>
          </span>
        ))}
        {text.slice(ranges.at(-1)?.end || 0)}
      </p>
    </div>
  );
}
