import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { CARDS, getCard } from "../shared/cards";
import { TOPICS } from "../shared/types";

test("deck contains 22 major and 56 minor cards with unique stable identities", () => {
  assert.equal(CARDS.length, 78);
  assert.equal(new Set(CARDS.map((c) => c.id)).size, 78);
  assert.equal(CARDS.filter((c) => c.group === "Ẩn chính").length, 22);
  for (const suit of ["wands", "cups", "swords", "pentacles"])
    assert.equal(CARDS.filter((c) => c.id.startsWith(`${suit}-`)).length, 14);
});

test("every card has local artwork and meaningful upright, reversed, topic data", () => {
  const upright = new Set<string>();
  const reversed = new Set<string>();
  for (const card of CARDS) {
    assert.ok(card.vi.length > 2 && card.en.length > 2);
    assert.ok(card.keywords.length >= 2);
    assert.ok(card.upright.split(/\s+/).length >= 25, card.id);
    assert.ok(card.reversed.split(/\s+/).length >= 25, card.id);
    assert.notEqual(card.upright, card.reversed);
    upright.add(card.upright);
    reversed.add(card.reversed);
    for (const topic of TOPICS) assert.ok(card.topics[topic].length > 30);
    const path = new URL(`../public${card.asset}`, import.meta.url);
    assert.ok(existsSync(path), `${card.id} artwork missing`);
    const image = readFileSync(path);
    assert.ok(
      card.asset.startsWith("/assets/rws/") && card.asset.endsWith(".jpg"),
    );
    assert.equal(
      image.readUInt16BE(0),
      0xffd8,
      "Default card artwork must be a JPEG scan",
    );
    assert.equal(
      image.readUInt16BE(image.length - 2),
      0xffd9,
      "JPEG image must be complete",
    );
    assert.equal(getCard(card.id), card);
  }
  assert.equal(upright.size, 78);
  assert.equal(reversed.size, 78);
  assert.equal(getCard("not-a-card"), undefined);
});
