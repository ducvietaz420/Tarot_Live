import test from "node:test";
import assert from "node:assert/strict";
import { Engine, DEFAULT_CONFIG } from "../server/engine.ts";
import {
  fallback,
  synthesize,
  words,
  validateAI,
  generateAI,
  MIN_AI_CARD_WORDS,
  MIN_AI_SUMMARY_WORDS,
} from "../server/providers.ts";
import { CARDS } from "../shared/cards.ts";
import { TOPICS, type Reading, type ReadingContent } from "../shared/types.ts";
import { normalizeEnvelope } from "../server/tikfinity.ts";

const fullCardText = "Trong quá khứ, bạn đã có rất nhiều nhiệt huyết và sự chủ động để vượt qua trì hoãn trong công việc. Lá bài này xuất hiện để nhắc bạn chuyển động lực thành một bước làm rõ trách nhiệm cụ thể. Bạn hãy tập trung hoàn thành dứt điểm một việc đã bắt đầu từ trước thay vì ôm đồm quá nhiều.";
const fullSummary = "Tuần tới, bạn hãy ưu tiên kiểm tra kỹ những thông tin liên quan đến công việc. Đừng nhận thêm trách nhiệm khi việc cũ chưa được hoàn thành. Hãy chọn một nhiệm vụ cụ thể để làm xong trước, rồi đánh giá kết quả.";
function fullAIContent(reading: Reading): ReadingContent {
  return {
    opening: "Cùng dành một khoảng lặng để nhìn lại câu hỏi về công việc của bạn. Ba lá bài giúp bạn xem lại điều đã qua, nhận ra vấn đề hiện tại và chọn một bước phù hợp.",
    cards: reading.cards.map((card) => ({ ...card, text: fullCardText, speech: fullCardText })),
    summary: fullSummary,
    source: "ai",
  };
}

test("AI hơi dài được rút gọn, vẫn giữ đúng bài, lời đọc và giới hạn từ", () => {
  const engine = new Engine();
  try {
    engine.action({ type: "config", config: { displayWords: 65, summaryWords: 50 } }, "demo");
    engine.action({ type: "demo", scenario: "full" }, "demo");
    const reading = engine.sessions.demo.active!;
    const raw = fullAIContent(reading);
    const extra =
      " Bạn có thể ghi lại cảm xúc của mình và dành thời gian quan sát thêm trước khi chọn một bước tiếp theo.";
    raw.cards.forEach((card) => {
      card.text += extra;
      card.speech = card.text;
    });
    raw.summary += extra;
    assert.ok(
      raw.cards.some(
        (card) => words(card.text) > reading.config.displayWords + 10,
      ),
    );
    const validated = validateAI(raw, reading);
    assert.deepEqual(
      validated.cards.map(({ cardId, position, reversed }) => ({
        cardId,
        position,
        reversed,
      })),
      reading.cards,
    );
    for (const card of validated.cards) {
      assert.ok(
        words(card.text) >= MIN_AI_CARD_WORDS &&
          words(card.text) <= reading.config.displayWords,
      );
      assert.equal(card.text, card.speech);
    }
    assert.ok(
      words(validated.summary) >= MIN_AI_SUMMARY_WORDS &&
        words(validated.summary) <= reading.config.summaryWords,
    );
    raw.cards[0].text = "nội dung ".repeat(200);
    assert.throws(() => validateAI(raw, reading));
  } finally {
    engine.close();
  }
});

test("Mọi lá/chủ đề/chiều đều có 45–70 từ, giữ gợi ý đúng chủ đề và lời đọc đúng chữ", () => {
  for (const max of [45, 65, 70])
    for (const c of CARDS)
      for (const topic of TOPICS)
        for (const reversed of [true, false]) {
          const reading = {
            cards: [
              { cardId: c.id, position: 0, reversed },
              { cardId: CARDS[1].id, position: 1, reversed: false },
              { cardId: CARDS[2].id, position: 2, reversed: true },
            ],
            topic,
            question: "Một câu hỏi tự chiêm nghiệm",
            config: { ...DEFAULT_CONFIG, displayWords: max, summaryWords: 50 },
          };
          const result = fallback(reading);
          assert.ok(
            words(result.cards[0].text) >= 45,
            `${c.id}/${topic}: ${result.cards[0].text}`,
          );
          assert.ok(words(result.cards[0].text) <= max);
          assert.ok(
            result.cards[0].text.includes(c.topics[topic]),
            `${c.id} thiếu gợi ý ${topic}`,
          );
          assert.equal(result.cards[0].text, result.cards[0].speech);
          assert.ok(
            words(result.summary) >= MIN_AI_SUMMARY_WORDS &&
            words(result.summary) <= reading.config.summaryWords,
          );
        }
});

test("AI đầy đủ giữ ba lá và chữ/giọng, từ chối lời giải tóm tắt", () => {
  const engine = new Engine();
  try {
    engine.action({ type: "config", config: { displayWords: 65, summaryWords: 50 } }, "demo");
    engine.action({ type: "demo", scenario: "full" }, "demo");
    const reading = engine.sessions.demo.active!;
    const raw = fullAIContent(reading);
    raw.cards.forEach((card) => { card.speech = "lời đọc khác"; });
    const content = validateAI(raw, reading);
    assert.equal(content.source, "ai");
    assert.deepEqual(content.cards.map(({ cardId, position, reversed }) => ({ cardId, position, reversed })), reading.cards);
    for (const card of content.cards) {
      assert.ok(words(card.text) >= 45 && words(card.text) <= 65);
      assert.equal(card.text, card.speech);
    }
    assert.ok(words(content.summary) >= 35 && words(content.summary) <= 50);
    const completeText = raw.cards[0].text;
    raw.cards[0].text = "Bạn nên làm rõ điều mình mong muốn trong mối quan hệ. Hãy trò chuyện bình tĩnh và chọn một việc nhỏ để cùng cải thiện.";
    assert.ok(words(raw.cards[0].text) >= 20 && words(raw.cards[0].text) <= 30);
    assert.throws(() => validateAI(raw, reading));
    raw.cards[0].text = completeText;
    raw.cards[0].reversed = !reading.cards[0].reversed;
    assert.throws(() => validateAI(raw, reading));
    raw.cards[0].reversed = reading.cards[0].reversed;
    raw.summary = "Ba lá bài gợi ý bạn cân bằng cảm xúc, nói rõ nhu cầu và cùng chọn một thay đổi vừa sức.";
    assert.ok(words(raw.summary) >= 15 && words(raw.summary) <= 25);
    assert.throws(() => validateAI(raw, reading));
  } finally { engine.close(); }
});

test("Tổng kết fallback đầy đủ giữ chủ đề và giới hạn 35–55 từ", () => {
  for (const summaryWords of [35, 50, 55])
    for (const topic of TOPICS) {
      const content = fallback({
        cards: [{ cardId: CARDS[0].id, position: 0, reversed: false }],
        topic,
        question: "Một câu hỏi mẫu",
        config: { ...DEFAULT_CONFIG, displayWords: 65, summaryWords },
      });
      assert.ok(words(content.summary) >= 35 && words(content.summary) <= summaryWords);
      assert.ok(content.summary.includes(topic.toLocaleLowerCase("vi")));
    }
});

test("Prompt yêu cầu lời giải đầy đủ, bám lá và câu hỏi theo giới hạn đã chọn", async () => {
  const previousFetch = globalThis.fetch;
  const names = ["AI_API_KEY", "AI_BASE_URL", "AI_MODEL"] as const;
  const previous = names.map((name) => process.env[name]);
  const engine = new Engine();
  try {
    process.env.AI_API_KEY = "fixture-only";
    process.env.AI_BASE_URL = "https://fixture.invalid/v1";
    process.env.AI_MODEL = "fixture-model";
    engine.action({ type: "demo", scenario: "full" }, "demo");
    const reading = engine.sessions.demo.active!;
    reading.config.displayWords = 65;
    reading.config.summaryWords = 50;
    reading.content = fullAIContent(reading);
    let captured: Record<string, any> | undefined;
    globalThis.fetch = async (_url, options) => {
      captured = JSON.parse(options!.body as string);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(fullAIContent(reading)) } }] }));
    };
    const result = await generateAI(reading, new AbortController().signal);
    const prompt = captured!.messages[0].content as string;
    assert.match(prompt, /lời giải tarot tiếng Việt đầy đủ/u);
    assert.match(prompt, /bằng lời nói hằng ngày/u);
    assert.match(prompt, /Trả lời thẳng điều người xem hỏi/u);
    assert.match(prompt, /Mỗi câu chỉ có một ý/u);
    assert.match(prompt, /Không dùng cách nói mơ hồ/u);
    assert.match(prompt, /text mỗi lá 45-65 từ/u);
    assert.match(prompt, /summary 35-50 từ/u);
    assert.match(prompt, /nhắm 50-60 từ mỗi lá và 35-45 từ tổng kết/u);
    assert.match(prompt, /không dùng dấu ba chấm, không viết dở câu/u);
    assert.match(prompt, /giải thích ý nghĩa lá và chiều xuôi\/ngược trong bối cảnh câu hỏi/u);
    assert.match(prompt, /opening giới thiệu nhẹ nhàng chủ đề trong tối đa 60 từ/u);
    assert.doesNotMatch(prompt, /2 câu ngắn|ưu tiên ít từ hơn/u);
    assert.match(prompt, /Viết trọn câu/u);
    assert.equal(result.source, "ai");
    assert.ok(result.cards.every((card) => words(card.text) >= 45 && words(card.text) <= 65));
    assert.ok(words(result.opening) > 20 && words(result.opening) <= 60);
    const payload = JSON.parse(captured!.messages[1].content);
    assert.deepEqual(payload.cards.map(({ cardId, position, reversed }: any) => ({ cardId, position, reversed })), reading.cards);
  } finally {
    engine.close();
    globalThis.fetch = previousFetch;
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    });
  }
});

test("Lời giải thực tế vượt trần giữ câu trọn vẹn, không cắt thành nhanh… hay quyết…", () => {
  const engine = new Engine();
  try {
    engine.action({ type: "demo", scenario: "full" }, "demo");
    const reading = engine.sessions.demo.active!;
    reading.config.displayWords = 65;
    reading.config.summaryWords = 50;
    const raw = fullAIContent(reading);
    raw.cards[2].text = "Hướng tới tương lai, một thay đổi hoặc nhận thức bất ngờ có thể làm xáo trộn kế hoạch cũ của bạn. Khi điều này xảy ra, bạn hãy bình tĩnh phân biệt vấn đề cốt lõi với bề nổi của dự án. Bạn hãy quay về nền tảng ban đầu và dựng lại mọi thứ từng bước thay vì cố gắng vá víu nhanh chóng.";
    raw.summary = "Tuần tới, bạn hãy kết hợp sự nhiệt tình sẵn có với việc kiểm tra kỹ thông tin để đối phó với các thay đổi bất ngờ. Điều bạn cần ưu tiên làm ngay là rà soát lại tất cả các dữ liệu công việc trước khi đưa ra quyết định.";
    assert.ok(words(raw.cards[2].text) > 65);
    assert.ok(words(raw.summary) > 50);
    const result = validateAI(raw, reading);
    assert.equal(result.cards[2].text, "Hướng tới tương lai, một thay đổi hoặc nhận thức bất ngờ có thể làm xáo trộn kế hoạch cũ của bạn. Khi điều này xảy ra, bạn hãy bình tĩnh phân biệt vấn đề cốt lõi với bề nổi của dự án.");
    assert.equal(result.summary, "Tuần tới, bạn hãy kết hợp sự nhiệt tình sẵn có với việc kiểm tra kỹ thông tin để đối phó với các thay đổi bất ngờ.");
    assert.ok(words(result.cards[2].text) >= 30 && words(result.cards[2].text) <= 65);
    assert.ok(words(result.summary) >= 20 && words(result.summary) < 35);
    assert.equal(result.cards[2].speech, result.cards[2].text);
    assert.ok(!JSON.stringify(result).includes("…"));
    assert.deepEqual(result.cards.map(({ cardId, position, reversed }) => ({ cardId, position, reversed })), reading.cards);
  } finally { engine.close(); }
});

test("AI từ chối câu dở, dấu ba chấm, markup và trần không đủ chứa một lời giải trọn câu", () => {
  const engine = new Engine();
  try {
    engine.action({ type: "demo", scenario: "full" }, "demo");
    const reading = engine.sessions.demo.active!;
    reading.config.displayWords = 65;
    reading.config.summaryWords = 50;
    for (const ending of ["…", "...", ""]) {
      const raw = fullAIContent(reading);
      raw.cards[0].text = raw.cards[0].text.slice(0, -1) + ending;
      assert.throws(() => validateAI(raw, reading));
      const summaryRaw = fullAIContent(reading);
      summaryRaw.summary = summaryRaw.summary.slice(0, -1) + ending;
      assert.throws(() => validateAI(summaryRaw, reading));
    }
    for (const invalid of ["<b>lời giải</b>", "lời giải\u0000", "**lời giải**"]) {
      const raw = fullAIContent(reading);
      raw.summary += invalid;
      assert.throws(() => validateAI(raw, reading));
    }
    const noCompleteFit = fullAIContent(reading);
    noCompleteFit.cards[0].text = "Nên chậm lại. " + "Bạn hãy kiểm tra dữ liệu cẩn thận ".repeat(10) + ".";
    assert.throws(() => validateAI(noCompleteFit, reading));
    const short = fullAIContent(reading);
    short.cards[0].text = "Bạn hãy kiểm tra các thông tin trước khi nhận thêm việc mới. Chọn một nhiệm vụ để hoàn thành trước rồi mới bắt đầu công việc khác.";
    assert.ok(words(short.cards[0].text) >= 25 && words(short.cards[0].text) < MIN_AI_CARD_WORDS);
    assert.throws(() => validateAI(short, reading), "Sàn 30 chỉ áp dụng sau khi cắt câu dài; raw ngắn vẫn phải bị từ chối");
  } finally { engine.close(); }
});
test("AI timeout thật chuyển fallback; kết quả cũ sau skip không chèn vào lượt mới", async () => {
  const previous = {
    fetch: globalThis.fetch,
    key: process.env.AI_API_KEY,
    url: process.env.AI_BASE_URL,
    model: process.env.AI_MODEL,
  };
  process.env.AI_API_KEY = "fixture-only";
  process.env.AI_BASE_URL = "https://fixture.invalid/v1";
  process.env.AI_MODEL = "fixture";
  const requests: {
    body: Record<string, unknown>;
    resolve: (v: Response) => void;
    signal: AbortSignal;
  }[] = [];
  globalThis.fetch = async (_url, init) =>
    await new Promise<Response>((resolve, reject) => {
      const signal = init!.signal!;
      requests.push({
        body: JSON.parse(init!.body as string),
        resolve,
        signal,
      });
      signal.addEventListener(
        "abort",
        () => reject(new DOMException("aborted", "AbortError")),
        { once: true },
      );
    });
  const e = new Engine();
  try {
    e.action(
      {
        type: "config",
        config: { joinMode: "free", aiEnabled: true, aiTimeoutSec: 2 },
      },
      "demo",
    );
    const emit = (id: string) =>
      e.ingest(
        normalizeEnvelope({
          event: "chat",
          data: {
            userId: id,
            msgId: `q-${id}`,
            nickname: id,
            comment:
              "!tarot công việc | Tôi nên phát triển điều gì trong thời gian tới?",
          },
        }),
        "demo",
      );
    emit("person-1");
    emit("person-2");
    e.start("demo");
    const old = e.sessions.demo.active!;
    assert.equal(requests.length, 1);
    e.action({ type: "skip" }, "demo");
    e.action({ type: "start" }, "demo");
    const current = e.sessions.demo.active!;
    assert.notEqual(old.id, current.id);
    assert.ok(requests[0].signal.aborted);
    requests[0].resolve(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(old.content) } }],
        }),
        { status: 200 },
      ),
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(e.sessions.demo.active?.id, current.id);
    assert.equal(e.sessions.demo.active?.content.source, "fallback");
    await new Promise((resolve) => setTimeout(resolve, 2150));
    assert.equal(e.sessions.demo.active?.content.source, "fallback");
    assert.ok(e.sessions.demo.active?.content.error);
    assert.deepEqual(e.sessions.demo.active?.cards, current.cards);
    assert.equal(requests.length, 2);
  } finally {
    e.close();
    globalThis.fetch = previous.fetch;
    for (const [key, value] of [
      ["AI_API_KEY", previous.key],
      ["AI_BASE_URL", previous.url],
      ["AI_MODEL", previous.model],
    ]) {
      if (value === undefined) delete process.env[key!];
      else process.env[key!] = value;
    }
  }
});
test("TTS chưa cấu hình hoặc response không audio báo lỗi để UI giữ chữ", async () => {
  const previous = { fetch: globalThis.fetch, url: process.env.TTS_URL };
  const e = new Engine();
  try {
    e.action({ type: "config", config: { joinMode: "free" } }, "demo");
    e.action({ type: "demo", scenario: "full" }, "demo");
    const r = e.sessions.demo.active as Reading;
    r.phase = "card1";
    delete process.env.TTS_URL;
    await assert.rejects(
      () => synthesize(r, new AbortController().signal),
      /Chưa cấu hình/,
    );
    process.env.TTS_URL = "https://fixture.invalid/tts";
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ url: "https://example.invalid/file.mp3" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    await assert.rejects(
      () => synthesize(r, new AbortController().signal),
      /trả trực tiếp file/,
    );
    assert.equal(e.sessions.demo.active?.id, r.id);
  } finally {
    e.close();
    globalThis.fetch = previous.fetch;
    if (previous.url === undefined) delete process.env.TTS_URL;
    else process.env.TTS_URL = previous.url;
  }
});
