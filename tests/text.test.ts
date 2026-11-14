import test from "node:test";
import assert from "node:assert/strict";
import { sentenceRanges, speechPages } from "../shared/text.ts";

test("Không cắt giữa một câu dài dù vượt ngưỡng từ cũ", () => {
  const sentence =
    "Trong giai đoạn hiện tại, bạn có thể dành thời gian lắng nghe cảm xúc của chính mình, trao đổi chân thành với người thân và lựa chọn một bước nhỏ phù hợp với những điều bạn đang thực sự cần.";
  const text = `Hãy cùng lắng nghe. ${sentence} Một khởi đầu nhẹ nhàng.`;
  const pages = speechPages(text, 24);
  assert.ok(pages.includes(sentence));
  assert.equal(pages.join(" "), text);
  assert.ok(
    !pages.some((page) => page.endsWith("chính") || page.startsWith("mình,")),
  );
});
test("Vị trí câu giữ nguyên tiếng Việt, emoji và khoảng trắng cho boundary giọng đọc", () => {
  const text =
    "  Bạn có thể dừng lại một chút.\n\n🌙 Hãy lắng nghe: “Mình đang cần điều gì?” Sau đó, chọn một hành động nhỏ.  ";
  const ranges = sentenceRanges(text);
  assert.ok(ranges.length >= 3);
  for (const range of ranges)
    assert.equal(text.slice(range.start, range.end), range.text);
  assert.equal(
    ranges
      .map((range) => range.text)
      .join(" ")
      .replace(/\s+/gu, " "),
    text.trim().replace(/\s+/gu, " "),
  );
  assert.deepEqual(speechPages("   "), []);
});
