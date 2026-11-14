import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { CARDS } from "../shared/cards";

const manifest = JSON.parse(
  readFileSync(
    new URL("../public/assets/rws/manifest.json", import.meta.url),
    "utf8",
  ),
) as {
  cards: {
    cardId: string;
    nameEn: string;
    nameVi: string;
    asset: string;
    commonsFile: string;
    sourcePage: string;
    downloadURL: string;
    sourceSHA1: string;
    sha1: string;
    sha256: string;
    license: string;
    sourceLabel: string;
    sourceWidth: number;
    sourceHeight: number;
    width: number;
    height: number;
    bytes: number;
  }[];
};
const labelKey = (value: string) =>
  value
    .toLowerCase()
    .replace(/^the\s+/u, "")
    .replace(/[^\p{L}\p{N}]/gu, "");

test("All78 default artwork files map to distinct authentic RWS source cards with intact local bytes", () => {
  assert.equal(manifest.cards.length, 78);
  assert.equal(new Set(manifest.cards.map((card) => card.cardId)).size, 78);
  assert.equal(
    new Set(manifest.cards.map((card) => card.commonsFile)).size,
    78,
  );
  assert.equal(new Set(manifest.cards.map((card) => card.sha256)).size, 78);
  for (const card of CARDS) {
    const source = manifest.cards.find((entry) => entry.cardId === card.id)!;
    assert.ok(source, `${card.id} source missing`);
    assert.equal(source.asset, card.asset);
    assert.equal(source.nameEn, card.en);
    assert.equal(source.nameVi, card.vi);
    assert.equal(
      labelKey(source.sourceLabel),
      labelKey(card.en),
      `${card.id} source card mismatch`,
    );
    assert.equal(source.license, "Public domain");
    assert.equal(new URL(source.sourcePage).hostname, "commons.wikimedia.org");
    assert.equal(new URL(source.downloadURL).hostname, "thumb.wikimedia.org");
    assert.equal(source.width, 500);
    assert.ok(source.height >= 800 && source.height <= 900);
    assert.ok(source.sourceWidth >= 1000 && source.sourceHeight >= 1800);
    assert.match(source.sourceSHA1, /^[a-f\d]{40}$/u);
    const bytes = readFileSync(
      new URL(`../public${card.asset}`, import.meta.url),
    );
    assert.equal(bytes.length, source.bytes);
    assert.equal(bytes.readUInt16BE(0), 0xffd8);
    assert.equal(createHash("sha1").update(bytes).digest("hex"), source.sha1);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      source.sha256,
    );
  }
});

test("RWS StrengthVIII/JusticeXI and all16 court ranks retain correct source identity", () => {
  const find = (id: string) =>
    manifest.cards.find((card) => card.cardId === id)!;
  assert.equal(find("strength").commonsFile, "File:RWS Tarot 08 Strength.jpg");
  assert.equal(find("justice").commonsFile, "File:RWS Tarot 11 Justice.jpg");
  const prefixes: Record<string, string> = {
    cups: "Cups",
    wands: "Wands",
    swords: "Swords",
    pentacles: "Pents",
  };
  const ranks: Record<number, string> = {
    11: "Page",
    12: "Knight",
    13: "Queen",
    14: "King",
  };
  for (const [suit, prefix] of Object.entries(prefixes))
    for (const [rank, label] of Object.entries(ranks)) {
      const source = find(`${suit}-${rank}`);
      assert.equal(source.commonsFile, `File:${prefix}${rank}.jpg`);
      assert.ok(source.nameEn.startsWith(`${label} of `));
    }
});
