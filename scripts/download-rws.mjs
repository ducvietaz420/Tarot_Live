import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { CARDS } from "../shared/cards.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = join(root, "public/assets/rws");
const category = "Category:Rider-Waite-Smith tarot deck (TaionWC)";
const headers = {
  "User-Agent":
    "TiemTarotLocal/1.0 (desktop tarot display; Wikimedia Commons source provenance)",
};
const majorNames = [
  "Fool",
  "Magician",
  "High Priestess",
  "Empress",
  "Emperor",
  "Hierophant",
  "Lovers",
  "Chariot",
  "Strength",
  "Hermit",
  "Wheel of Fortune",
  "Justice",
  "Hanged Man",
  "Death",
  "Temperance",
  "Devil",
  "Tower",
  "Star",
  "Moon",
  "Sun",
  "Judgement",
  "World",
];
const suitNames = {
  cups: "Cups",
  pentacles: "Pents",
  swords: "Swords",
  wands: "Wands",
};
const plain = (value) =>
  String(value || "")
    .replace(/<[^>]*>/gu, "")
    .replace(/&amp;/gu, "&")
    .trim();
const labelKey = (value) =>
  plain(value)
    .toLowerCase()
    .replace(/^the\s+/u, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
const sha = (type, bytes) => createHash(type).update(bytes).digest("hex");
async function request(url) {
  let last;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(45000),
      });
      if (res.status === 429) {
        const seconds =
          Number(res.headers.get("retry-after")) ||
          Math.min(30, 5 * 2 ** attempt);
        await res.arrayBuffer();
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(30000, seconds * 1000)),
        );
        last = new Error(`HTTP429 ${new URL(url).pathname}`);
        continue;
      }
      if (!res.ok)
        throw new Error(`HTTP ${res.status} ${new URL(url).pathname}`);
      return res;
    } catch (error) {
      last = error;
      if (attempt < 7)
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(30000, 1000 * 2 ** attempt)),
        );
    }
  }
  throw last;
}
async function api(params) {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  for (const [key, value] of Object.entries({
    action: "query",
    format: "json",
    ...params,
  }))
    url.searchParams.set(key, value);
  return (await request(url)).json();
}
function jpegDimensions(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8)
    throw new Error("Downloaded asset is not a JPEG");
  let at = 2;
  while (at + 8 < bytes.length) {
    if (bytes[at++] !== 0xff) throw new Error("Invalid JPEG marker");
    while (bytes[at] === 0xff) at++;
    const marker = bytes[at++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    const length = bytes.readUInt16BE(at);
    if (length < 2 || at + length > bytes.length)
      throw new Error("Invalid JPEG block");
    if (
      [
        0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
        0xcf,
      ].includes(marker)
    )
      return {
        width: bytes.readUInt16BE(at + 5),
        height: bytes.readUInt16BE(at + 3),
      };
    at += length;
  }
  throw new Error("JPEG dimensions missing");
}

await mkdir(output, { recursive: true });
const members = (
  await api({
    list: "categorymembers",
    cmtitle: category,
    cmlimit: "100",
    cmtype: "file",
  })
).query.categorymembers;
if (members.length !== 78)
  throw new Error(`Expected full78 category; received${members.length}`);
const entries = CARDS.map((card, index) => {
  const title =
    card.group === "Ẩn chính"
      ? `File:RWS Tarot ${String(index).padStart(2, "0")} ${majorNames[index]}.jpg`
      : (() => {
          const [, suit, rank] =
            card.id.match(/^(cups|pentacles|swords|wands)-(\d+)$/u) || [];
          if (!suit) throw new Error(`Unexpected card ${card.id}`);
          return `File:${suitNames[suit]}${rank.padStart(2, "0")}.jpg`;
        })();
  if (!members.some((member) => member.title === title))
    throw new Error(`Missing Commons card: ${title}`);
  return { card, title };
});
const metadata = new Map();
for (let at = 0; at < entries.length; at += 40) {
  const response = await api({
    prop: "imageinfo",
    iiprop: "url|size|sha1|extmetadata|timestamp",
    iiurlwidth: "500",
    titles: entries
      .slice(at, at + 40)
      .map((entry) => entry.title)
      .join("|"),
  });
  for (const page of Object.values(response.query.pages))
    metadata.set(page.title, page.imageinfo?.[0]);
}
let next = 0,
  finished = 0;
let previousManifest;
try {
  previousManifest = JSON.parse(
    await readFile(join(output, "manifest.json"), "utf8"),
  );
} catch {}
const manifest = new Array(entries.length);
await Promise.all(
  Array.from({ length: 1 }, async () => {
    while (next < entries.length) {
      const index = next++;
      const { card, title } = entries[index];
      const info = metadata.get(title);
      if (!info) throw new Error(`Missing image metadata ${title}`);
      const ext = info.extmetadata || {};
      if (
        ext.LicenseShortName?.value !== "Public domain" ||
        String(ext.Copyrighted?.value).toLowerCase() !== "false"
      )
        throw new Error(`Public-domain status not confirmed: ${title}`);
      const description = plain(ext.ImageDescription?.value);
      const sourceLabel = description.split("—")[0].trim();
      if (labelKey(sourceLabel) !== labelKey(card.en))
        throw new Error(
          `Identity mismatch ${card.id}: ${sourceLabel} != ${card.en}`,
        );
      const upstream = new URL(info.thumburl);
      upstream.search = "";
      const asset = `/assets/rws/${card.id}.jpg`;
      const file = join(output, `${card.id}.jpg`);
      let bytes;
      try {
        bytes = await readFile(file);
        const previous = previousManifest?.cards.find(
          (entry) => entry.cardId === card.id,
        );
        if (
          !previous ||
          previous.sourceSHA1 !== info.sha1 ||
          sha("sha256", bytes) !== previous.sha256
        )
          bytes = undefined;
      } catch {}
      if (!bytes) {
        bytes = Buffer.from(await (await request(upstream.href)).arrayBuffer());
        await writeFile(file, bytes);
        await new Promise((resolve) => setTimeout(resolve, 900));
      }
      const dimensions = jpegDimensions(bytes);
      if (
        dimensions.width !== info.thumbwidth ||
        dimensions.height !== info.thumbheight ||
        dimensions.width !== 500 ||
        dimensions.height < 800
      )
        throw new Error(`Unexpected dimensions: ${title}`);
      manifest[index] = {
        cardId: card.id,
        nameVi: card.vi,
        nameEn: card.en,
        asset,
        commonsFile: title,
        sourcePage: info.descriptionurl,
        downloadURL: upstream.href,
        originalURL: new URL(info.url).origin + new URL(info.url).pathname,
        sourceSHA1: info.sha1,
        sourceWidth: info.width,
        sourceHeight: info.height,
        rendition: "Wikimedia Commons 500px thumbnail, whole original card",
        sourceDate: plain(ext.DateTimeOriginal?.value),
        artist: plain(ext.Artist?.value),
        license: ext.LicenseShortName.value,
        licenseURL: "https://creativecommons.org/publicdomain/mark/1.0/",
        sourceRevisionTimestamp: info.timestamp,
        width: dimensions.width,
        height: dimensions.height,
        bytes: bytes.length,
        sha1: sha("sha1", bytes),
        sha256: sha("sha256", bytes),
        sourceLabel,
      };
      finished++;
      if (finished % 10 === 0 || finished === entries.length)
        console.log(`RWS ${finished}/${entries.length}`);
    }
  }),
);
if (new Set(manifest.map((entry) => entry.sha256)).size !== 78)
  throw new Error("Duplicate artwork detected");
const result = {
  deck: "Rider–Waite–Smith — Pam-A original scans",
  artist: "Pamela Colman Smith",
  sourceCategory:
    "https://commons.wikimedia.org/wiki/Category:Rider-Waite-Smith_tarot_deck_(TaionWC)",
  retrievedDate: "2026-11-14",
  license: "Public domain, as recorded on individual Wikimedia Commons files",
  licenseURL: "https://creativecommons.org/publicdomain/mark/1.0/",
  modifications:
    "Official Wikimedia Commons 500 px whole-card renditions downloaded without local cropping, recoloring, or retouching. Original source SHA1 and local rendition SHA256 are recorded separately.",
  cards: manifest,
};
await writeFile(
  join(output, "manifest.json"),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    cards: manifest.length,
    bytes: manifest.reduce((sum, item) => sum + item.bytes, 0),
    uniqueSHA256: new Set(manifest.map((entry) => entry.sha256)).size,
  }),
);
