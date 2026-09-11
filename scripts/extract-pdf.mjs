// One-off: pull the 100-mountain table out of hyakumeizan-checklist.pdf.
// The PDF embeds subset TrueType fonts, so text must be mapped back through
// each font's /ToUnicode CMap. Kept in the repo only for provenance.
import { readFileSync, writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

const pdf = readFileSync(new URL("../hyakumeizan-checklist.pdf", import.meta.url));

const objects = new Map();
for (const m of pdf.toString("latin1").matchAll(/(\d+)\s+0\s+obj\b/g)) {
  const start = m.index + m[0].length;
  objects.set(Number(m[1]), pdf.subarray(start, pdf.indexOf("endobj", start)));
}

function streamOf(num) {
  const body = objects.get(num);
  const m = /(?<!end)stream\r?\n/.exec(body.toString("latin1"));
  const raw = body.subarray(m.index + m[0].length, body.lastIndexOf("endstream"));
  try {
    return inflateSync(raw).toString("latin1");
  } catch {
    return ascii85Inflate(raw);
  }
}

function ascii85Inflate(raw) {
  const s = raw.toString("latin1").replace(/\s/g, "").replace(/^<~/, "").replace(/~>$/, "");
  const out = [];
  let group = [];
  for (const ch of s) {
    if (ch === "z" && group.length === 0) { out.push(0, 0, 0, 0); continue; }
    group.push(ch.charCodeAt(0) - 33);
    if (group.length === 5) { out.push(...decodeGroup(group, 4)); group = []; }
  }
  if (group.length > 1) {
    const n = group.length - 1;
    while (group.length < 5) group.push(84);
    out.push(...decodeGroup(group, n));
  }
  return inflateSync(Buffer.from(out)).toString("latin1");
}

function decodeGroup(group, keep) {
  let v = 0;
  for (const d of group) v = v * 85 + d;
  return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255].slice(0, keep);
}

function parseCMap(text) {
  const map = new Map();
  for (const [, block] of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const [, code, uni] of block.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      map.set(parseInt(code, 16), Buffer.from(uni, "hex").swap16().toString("utf16le"));
    }
  }
  for (const [, block] of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const [, lo, hi, base] of block.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      for (let i = parseInt(lo, 16); i <= parseInt(hi, 16); i++) {
        map.set(i, String.fromCodePoint(parseInt(base, 16) + i - parseInt(lo, 16)));
      }
    }
  }
  return map;
}

const fonts = { "F2+0": parseCMap(streamOf(8)), "F2+1": parseCMap(streamOf(12)) };
// Bytes absent from a subset font's CMap are plain cp1252 (the PDF writer emits
// en dashes and middots that way). Only the handful we actually see are needed.
const CP1252 = { 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—" };

function unescapePdfString(body) {
  const out = [];
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== "\\") { out.push(body.charCodeAt(i)); continue; }
    const next = body[i + 1];
    if (/[0-7]/.test(next)) {
      let digits = "";
      while (digits.length < 3 && /[0-7]/.test(body[i + 1])) digits += body[++i];
      out.push(parseInt(digits, 8));
      continue;
    }
    out.push({ n: 10, r: 13, t: 9, b: 8, f: 12 }[next] ?? next.charCodeAt(0));
    i++;
  }
  return out;
}

const TOKEN = /\/(F[\w+]+)\s+[\d.]+\s+Tf|\((?:\\.|[^\\()])*\)\s*Tj|BT|ET|T\*|-?[\d.]+\s+-?[\d.]+\s+Td/g;

const lines = [];
for (const page of [19, 20, 21, 22]) {
  let font = null;
  let chunks = [];
  for (const m of streamOf(page).matchAll(TOKEN)) {
    if (m[0].endsWith("Tf")) { font = m[1]; continue; }
    if (m[0].endsWith("Tj")) {
      const body = m[0].slice(1, m[0].lastIndexOf(")"));
      const map = fonts[font];
      chunks.push(unescapePdfString(body)
        .map((b) => map?.get(b) ?? CP1252[b] ?? String.fromCharCode(b))
        .join(""));
      continue;
    }
    if (chunks.length) { lines.push(chunks.join("")); chunks = []; }
  }
  if (chunks.length) lines.push(chunks.join(""));
}

writeFileSync(new URL("../db/pdf-rows.json", import.meta.url), JSON.stringify(parseRows(lines), null, 2) + "\n");

function parseRows(lines) {
  const mountains = [];
  let prefectureJa = null;
  let prefecture = null;
  for (let i = 0; i < lines.length; i++) {
    // Prefecture header: 〜県 / 北海道 / 東京都 / 大阪府, then ROMAJI, then a count.
    if (/^(.+[県都府]|北海道)$/.test(lines[i]) && /^[A-Z]+$/.test(lines[i + 1] ?? "")) {
      prefectureJa = lines[i];
      prefecture = titleCase(lines[i + 1]);
      i += 2;
      continue;
    }
    // Mountain row: number, kanji, kana, English, meta, elevation.
    if (/^\d{1,3}$/.test(lines[i]) && /^[ぁ-ゖァ-ヺー]+$/.test(lines[i + 2] ?? "") && /m$/.test(lines[i + 5] ?? "")) {
      const [num, kanji, kana, nameEn, meta, elev] = lines.slice(i, i + 6);
      mountains.push({ fukadaNumber: Number(num), nameKanji: kanji, nameKana: kana, nameEn, prefecture, prefectureJa,
                       elevationM: Number(elev.replace(/[^\d]/g, "")), ...splitMeta(meta) });
      i += 5;
    }
  }
  return mountains;
}

// "Ou · Jul–Oct · volcano  ·  Akita" -> region / season / notes / alsoIn.
// A double-spaced middot separates trailing co-owning prefectures.
function splitMeta(meta) {
  const [main, ...also] = meta.split("  ·  ");
  const [region, season, ...notes] = main.split(" · ").map((s) => s.trim());
  return { region, bestSeason: season ?? null, notes: notes.join("; ") || null,
           alsoIn: also.map((s) => s.trim()).filter(Boolean) };
}

function titleCase(s) {
  return s.toLowerCase().replace(/(^|-)([a-z])/g, (_, sep, c) => sep + c.toUpperCase());
}
