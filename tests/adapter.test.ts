import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { WebSocketServer } from "ws";
import {
  normalizeEnvelope,
  TikFinityAdapter,
  validateTikFinityURL,
} from "../server/tikfinity.ts";

test("legacy and nested chat preserve string IDs and avatar ownership", () => {
  const old = normalizeEnvelope({
    event: "chat",
    data: {
      userId: "7234567890123456789",
      uniqueId: "an.demo",
      nickname: "An",
      comment: "!tarot tình duyên | Nên chú ý gì?",
      msgId: "m-1",
      profilePictureUrl: "https://example.com/a.png",
    },
  });
  const modern = normalizeEnvelope(
    JSON.stringify({
      event: "chat",
      data: {
        common: { msgId: "m-2", roomId: "room-1" },
        user: {
          id: "7234567890123456790",
          displayId: "an.other",
          nickname: "An",
          avatarThumb: { urlList: ["https://example.com/b.png"] },
        },
        content: "Công việc: cho em xem hướng đi mới",
      },
    }),
  );
  assert.equal(old.user?.id, "7234567890123456789");
  assert.equal(modern.user?.id, "7234567890123456790");
  assert.notEqual(old.user?.avatar, modern.user?.avatar);
  assert.equal(modern.comment, "Công việc: cho em xem hướng đi mới");
  assert.equal(modern.id, "m-2");
  assert.equal(modern.roomId, "room-1");
});

test("invalid data is reported and unsafe numeric IDs never assigned", () => {
  for (const input of [
    "not json",
    null,
    [],
    { event: "chat", data: [] },
    { event: "gift" },
  ])
    assert.equal(normalizeEnvelope(input).type, "invalid");
  const unsafe = normalizeEnvelope({
    event: "chat",
    data: {
      userId: 7234567890123456789,
      nickname: "An",
      uniqueId: "handle",
      comment: "hello",
    },
  });
  assert.equal(unsafe.user, undefined);
  assert.ok(unsafe.issues.some((issue) => issue.includes("không an toàn")));
  const conflict = normalizeEnvelope({
    event: "chat",
    data: { userId: "one", user: { id: "two" }, comment: "hello" },
  });
  assert.equal(conflict.user, undefined);
  assert.ok(conflict.issues.some((issue) => issue.includes("Xung đột")));
  const script = normalizeEnvelope({
    event: "chat",
    data: {
      userId: "1",
      comment: "<script>alert(1)</script>",
      profilePictureUrl: "javascript:alert(1)",
    },
  });
  assert.equal(script.comment, "<script>alert(1)</script>");
  assert.equal(script.user?.avatar, undefined);
  const local = normalizeEnvelope({
    event: "chat",
    data: {
      userId: "1",
      comment: "hello",
      profilePictureUrl: "/assets/avatars/avatar-1.svg",
    },
  });
  assert.equal(local.user?.avatar, "/assets/avatars/avatar-1.svg");
});

test("gift metadata keeps cumulative counts, final flag, IDs and per-unit values", () => {
  const fixtures = [1, 2, 3, 3].map((repeatCount, index) =>
    normalizeEnvelope({
      event: "gift",
      data: {
        userId: "one",
        nickname: "An",
        giftId: 5655,
        giftName: "Rose",
        diamondCount: 1,
        giftType: 1,
        repeatCount,
        repeatEnd: index === 3 ? "true" : "0",
        groupId: "combo-001",
        msgId: `m-${index}`,
      },
    }),
  );
  assert.deepEqual(
    fixtures.map((event) => event.repeatCount),
    [1, 2, 3, 3],
  );
  assert.deepEqual(
    fixtures.map((event) => event.repeatEnd),
    [false, false, false, true],
  );
  assert.ok(
    fixtures.every(
      (event) =>
        event.coins === 1 &&
        event.comboId === "combo-001" &&
        event.giftId === "5655",
    ),
  );
  const modern = normalizeEnvelope({
    event: "gift",
    data: {
      common: { msgId: "m-5" },
      user: { id: "two" },
      giftId: "gift-2",
      groupId: "combo-002",
      repeatCount: "2",
      repeatEnd: 1,
      gift: { type: 1, name: "Quà", diamondCount: 5 },
    },
  });
  assert.equal(modern.coins, 5);
  assert.equal(modern.repeatEnd, true);
  assert.equal(modern.repeatCount, 2);
});

test("missing gift metadata remains unknown instead of guessing", () => {
  const unknown = normalizeEnvelope({
    event: "gift",
    data: { userId: "one", giftId: "rose" },
  });
  assert.equal(unknown.coins, undefined);
  assert.equal(unknown.repeatCount, undefined);
  assert.equal(unknown.giftType, undefined);
  assert.equal(unknown.comboId, undefined);
  assert.ok(unknown.issues.length >= 4);
  const noGroup = normalizeEnvelope({
    event: "gift",
    data: {
      userId: "one",
      giftId: "rose",
      giftType: 1,
      groupId: "0",
      repeatCount: 2,
      repeatEnd: 1,
      msgId: "m-1",
    },
  });
  assert.equal(noGroup.comboId, undefined);
  assert.ok(noGroup.issues.some((issue) => issue.includes("không gộp")));
});

test("likes distinguish delta from cumulative; roomUser does not invent users", () => {
  const legacy = normalizeEnvelope({
    event: "like",
    data: { likeCount: 3, totalLikeCount: 1234 },
  });
  const modern = normalizeEnvelope({
    event: "like",
    data: { count: "5", total: "1239" },
  });
  assert.deepEqual(
    [
      legacy.likeCount,
      legacy.totalLikeCount,
      modern.likeCount,
      modern.totalLikeCount,
    ],
    [3, 1234, 5, 1239],
  );
  assert.equal(
    normalizeEnvelope({
      event: "roomUser",
      data: { total: 800, ranks: [{ user: { id: "one" } }] },
    }).user,
    undefined,
  );
  assert.ok(
    normalizeEnvelope({ event: "member", data: {} }).issues.some((issue) =>
      issue.includes("chưa được hỗ trợ"),
    ),
  );
});

test("URL validation rejects protocols and embedded credentials", () => {
  assert.equal(
    validateTikFinityURL("ws://localhost:21213"),
    "ws://localhost:21213/",
  );
  for (const url of [
    "http://localhost:21213",
    "file:///test",
    "ws://user:password@localhost:21213",
    "x",
  ])
    assert.throws(() => validateTikFinityURL(url));
});

test("adapter uses one socket and only supported event updates LIVE timestamp", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const events: string[] = [];
  let connections = 0;
  server.on("connection", (socket) => {
    connections++;
    socket.send(JSON.stringify({ event: "ping", data: {} }));
    socket.send(
      JSON.stringify({
        event: "chat",
        data: { userId: "u1", msgId: "m1", comment: "hello" },
      }),
    );
  });
  const adapter = new TikFinityAdapter(
    `ws://127.0.0.1:${address.port}/`,
    (event) => events.push(event.type),
  );
  adapter.connect();
  adapter.connect();
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("no chat received")),
      2000,
    );
    const interval = setInterval(() => {
      if (events.includes("chat")) {
        clearTimeout(timeout);
        clearInterval(interval);
        resolve();
      }
    }, 10);
  });
  assert.equal(connections, 1);
  assert.equal(adapter.status.status, "connected");
  assert.ok(adapter.status.lastEventAt);
  assert.deepEqual(events, ["ping", "chat"]);
  adapter.stop();
  assert.equal(adapter.status.status, "disconnected");
  for (const socket of server.clients) socket.terminate();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
