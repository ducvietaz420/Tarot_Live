export interface SentenceRange {
  text: string;
  start: number;
  end: number;
}

/** UTF-16 offsets match SpeechSynthesis boundary events and String.slice. */
export function sentenceRanges(text: string): SentenceRange[] {
  const segments =
    typeof Intl.Segmenter === "function"
      ? Array.from(
          new Intl.Segmenter("vi", { granularity: "sentence" }).segment(text),
          (part) => ({ text: part.segment, start: part.index }),
        )
      : Array.from(
          text.matchAll(/[^.!?…]+(?:[.!?…]+[”"')\]]*|$)/gu),
          (part) => ({ text: part[0], start: part.index! }),
        );
  const ranges: SentenceRange[] = [];
  for (const segment of segments) {
    const leading = segment.text.length - segment.text.trimStart().length;
    const value = segment.text.trim();
    if (value)
      ranges.push({
        text: value,
        start: segment.start + leading,
        end: segment.start + leading + value.length,
      });
  }
  return ranges;
}

/** Legacy display/TTS grouping has a SOFT limit: an intact sentence is never cut. */
export function speechPages(text: string, softWords = 24): string[] {
  if (!Number.isFinite(softWords) || softWords < 1)
    throw new RangeError("softWords must be positive");
  const ranges = sentenceRanges(text);
  const groups: string[] = [];
  let start = 0,
    end = 0,
    count = 0;
  for (const range of ranges) {
    const words = range.text.split(/\s+/u).length;
    if (count && count + words > softWords) {
      groups.push(text.slice(start, end));
      count = 0;
    }
    if (!count) start = range.start;
    end = range.end;
    count += words;
  }
  if (count) groups.push(text.slice(start, end));
  return groups;
}
