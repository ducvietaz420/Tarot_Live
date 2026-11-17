import type { Reading, ReadingContent } from "../../shared/types.ts";

/** Valid provider prose, separate from fallback text which may end in an ellipsis. */
export function aiReadingContent(reading: Pick<Reading, "cards">): ReadingContent {
  const text = "Bạn đang có nhiều điều muốn làm nhưng cần chọn việc quan trọng nhất trước. Lá bài nhắc bạn quan sát những gì đã xảy ra, nói rõ nhu cầu của mình và thử một bước nhỏ trong tuần này. Sau đó, hãy xem kết quả thực tế để điều chỉnh.";
  return {
    opening: "Ba lá bài giúp bạn nhìn lại hoàn cảnh và chọn bước tiếp theo.",
    cards: reading.cards.map((card) => ({ ...card, text, speech: text })),
    summary: "Ba lá bài gợi ý bạn nhìn rõ điều mình cần và chọn một việc nhỏ có thể làm ngay. Hãy trao đổi thẳng thắn, quan sát phản hồi thực tế và dành thêm thời gian trước khi đưa ra quyết định lớn.",
    source: "ai",
  };
}
