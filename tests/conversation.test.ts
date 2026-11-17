import test from "node:test";
import assert from "node:assert/strict";
import { parseConversation } from "../server/conversation.ts";

test("Tarot enrolls without a command and a topic-only reply still needs a question", () => {
  assert.deepEqual(parseConversation("Tarot", 220), { question: "", join: true });
  assert.deepEqual(parseConversation("Cho em xem tarot với ạ", 220), { question: "", join: true });
  assert.deepEqual(parseConversation("Tôi muốn xem về tình duyên", 220), { topic: "Tình duyên", question: "", join: false });
  assert.deepEqual(parseConversation("Tình duyên ạ!", 220), { topic: "Tình duyên", question: "", join: false });
  assert.equal(parseConversation("Tôi muốn xem tình duyên và công việc", 220)?.question, "", "A list of topics is not a specific question");
  assert.equal(parseConversation("tarotreader", 220), undefined);
  assert.equal(parseConversation("!tarot tình duyên | chuyện của tôi thế nào?", 220), undefined);
  assert.equal(parseConversation("!hoi", 220, "Tình duyên"), undefined);
});

test("One complete reply retains its specific question and the selected topic", () => {
  const question = "Tôi muốn biết tôi và bạn gái của tôi có ở bên nhau dài lâu không?";
  assert.deepEqual(parseConversation(`Tôi muốn xem về tình duyên, ${question}`, 220), { topic: "Tình duyên", question, join: false });
  assert.deepEqual(parseConversation("Công việc: Tôi nên chuyển việc vào lúc nào?", 220), { topic: "Công việc", question: "Tôi nên chuyển việc vào lúc nào?", join: false });
  assert.deepEqual(parseConversation("Tôi và người yêu nên làm gì để hiểu nhau hơn?", 220, "Tình duyên"), { topic: "Tình duyên", question: "Tôi và người yêu nên làm gì để hiểu nhau hơn?", join: false });
  assert.deepEqual(parseConversation("Tôi nên đổi công việc hiện tại không?", 220, "Tình duyên"), { topic: "Công việc", question: "Tôi nên đổi công việc hiện tại không?", join: false });
});

test("Vietnamese accents, composed text, and natural topic names are understood", () => {
  for (const [text, topic] of [["tinh duyen", "Tình duyên"], ["cong viec", "Công việc"], ["tien bac", "Tiền bạc"], ["hoc hanh", "Học hành"], ["gia dinh", "Gia đình"], ["tài chính", "Tiền bạc"], ["sự nghiệp", "Công việc"], ["học tập", "Học hành"]]) {
    assert.deepEqual(parseConversation(`Tôi muốn xem về ${text}`, 220), { topic, question: "", join: false });
  }
  assert.equal(parseConversation("Tôi muốn xem về tình duyên".normalize("NFD"), 220)?.topic, "Tình duyên");
});

test("Ordinary social comments cannot become reading questions", () => {
  for (const text of ["Xin chào mọi người", "Cảm ơn bạn nhiều", "❤️❤️❤️", "Tôi muốn xem", "Tình duyên", "https://example.com Tình duyên", "aaaaaaaaaaaa", "!hoi Tôi nên làm gì?"]) {
    const result = parseConversation(text, 220, "Tình duyên");
    assert.ok(!result?.question, text);
  }
  assert.equal(parseConversation("Tôi nên làm gì?", 220), undefined, "A stranger's normal chat does not enroll them");
  assert.equal(parseConversation(`Công việc: ${"Tôi muốn biết thêm. ".repeat(30)}`, 220), undefined);
});
