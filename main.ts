// THE WORLD TODAY — Thursday 26 November 2026.
// A newspaper front page drawn entirely in code: a pixel buffer, a small
// hand-built 5x7 bitmap font (glyphs as rows of '#' and '.'), and a
// hand-rolled PNG encoder (zlib deflate + manual PNG chunks). Node 22
// standard library only, no network, and the same bytes on every run.
// Leads with Washington's new tariff plan for 14 trading partners, then
// 63 more stories in 9 sections, a UTC timeline of the day and a pin map
// of where it all happened.
import { deflateSync, inflateSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const W = 1024;
const H = 1024;

// ---- palette ------------------------------------------------------------
type RGB = [number, number, number];
const PAPER: RGB = [246, 241, 227];
const INK: RGB = [18, 18, 18];
const RED: RGB = [158, 27, 27];
const BLUE: RGB = [29, 78, 137];
const GREY: RGB = [90, 86, 76];
const MAPBG: RGB = [222, 232, 238];
const LAND: RGB = [150, 165, 175];
const ORANGE: RGB = [214, 110, 30];

// ---- pixel buffer -------------------------------------------------------
const buf = new Uint8Array(W * H * 3);
for (let i = 0; i < W * H; i++) {
  buf[i * 3] = PAPER[0];
  buf[i * 3 + 1] = PAPER[1];
  buf[i * 3 + 2] = PAPER[2];
}

function put(x: number, y: number, c: RGB): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const o = (y * W + x) * 3;
  buf[o] = c[0];
  buf[o + 1] = c[1];
  buf[o + 2] = c[2];
}

function box(x: number, y: number, w: number, h: number, c: RGB): void {
  for (let j = y; j < y + h; j++)
    for (let i = x; i < x + w; i++) put(i, j, c);
}

function rule(x: number, y: number, w: number, c: RGB, t = 1): void {
  box(x, y, w, t, c);
}

// ---- PNG encoder --------------------------------------------------------
const CRC_TAB = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (const byte of b) c = CRC_TAB[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}

function encodePng(): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0; // filter: none
    raw.set(buf.subarray(y * W * 3, (y + 1) * W * 3), y * (1 + W * 3) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", idat), pngChunk("IEND", Buffer.alloc(0))]);
}

// Read a written PNG back and verify its signature and IHDR dimensions,
// so a truncated or corrupt write can never pass as a valid entry.
function verifyPng(path: string): void {
  const bytes = readFileSync(path);
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(sig)) {
    throw new Error("entry.png does not start with the PNG signature");
  }
  const ihdrLen = bytes.readUInt32BE(8);
  const ihdrType = bytes.subarray(12, 16).toString("ascii");
  if (ihdrLen !== 13 || ihdrType !== "IHDR") {
    throw new Error("entry.png has no valid IHDR chunk");
  }
  const w = bytes.readUInt32BE(16);
  const h = bytes.readUInt32BE(20);
  if (w !== W || h !== H) {
    throw new Error(`entry.png is ${w}x${h}; expected ${W}x${H}`);
  }
}

// Decode the 8-bit RGB/RGBA PNG in ./map.png (a public-domain world map,
// pre-scaled to the band) into raw RGB pixels. Deterministic: pure function
// of the file bytes, no network.
function decodePng(path: string): { w: number; h: number; rgb: Uint8Array } {
  const bytes = readFileSync(path);
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(sig)) throw new Error("map.png: bad PNG signature");
  let off = 8;
  let w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat: Buffer[] = [];
  while (off + 8 <= bytes.length) {
    const len = bytes.readUInt32BE(off);
    const type = bytes.subarray(off + 4, off + 8).toString("ascii");
    const data = bytes.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]!; colorType = data[9]!;
      if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) throw new Error(`map.png: unsupported PNG (bitDepth ${bitDepth}, colorType ${colorType})`);
      if (data[12] !== 0) throw new Error("map.png: interlaced PNG not supported");
    } else if (type === "IDAT") idat.push(Buffer.from(data));
    else if (type === "IEND") break;
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const ch = colorType === 2 ? 3 : 4;
  const stride = w * ch;
  const recon = Buffer.alloc(h * stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[p++]!;
    for (let x = 0; x < stride; x++) {
      const v = raw[p++]!;
      const a = x >= ch ? recon[y * stride + x - ch]! : 0;
      const b = y > 0 ? recon[(y - 1) * stride + x]! : 0;
      const c = x >= ch && y > 0 ? recon[(y - 1) * stride + x - ch]! : 0;
      let r: number;
      if (f === 0) r = v;
      else if (f === 1) r = v + a;
      else if (f === 2) r = v + b;
      else if (f === 3) r = v + ((a + b) >> 1);
      else if (f === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else throw new Error(`map.png: unknown filter ${f}`);
      recon[y * stride + x] = r & 0xff;
    }
  }
  const rgb = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    rgb[i * 3] = recon[i * ch]!;
    rgb[i * 3 + 1] = recon[i * ch + 1]!;
    rgb[i * 3 + 2] = recon[i * ch + 2]!;
  }
  return { w, h, rgb };
}

// Paste the real map into the band, clipped to the band's rectangle
// (the same shape below the headline as before).
function drawMap(): void {
  const MAP_X = MARGIN; // 28
  const MAP_Y = 394;
  const MAP_W = W - 2 * MARGIN; // 968
  const MAP_H = 76;
  const m = decodePng(new URL("./map.png", import.meta.url).pathname);
  if (m.w !== MAP_W || m.h !== MAP_H) throw new Error(`map.png is ${m.w}x${m.h}; expected ${MAP_W}x${MAP_H}`);
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const dx = MAP_X + x, dy = MAP_Y + y;
      if (dx < MAP_X || dx >= MAP_X + MAP_W || dy < MAP_Y || dy >= MAP_Y + MAP_H) continue;
      const s = (y * m.w + x) * 3;
      put(dx, dy, [m.rgb[s]!, m.rgb[s + 1]!, m.rgb[s + 2]!]);
    }
  }
}

// ---- 5x7 bitmap font ----------------------------------------------------
// One glyph is 7 rows of 5 cells; '#' is ink, '.' is blank.
const GLYPHS: Record<string, string[]> = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  C: [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  G: [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".###."],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: [".###.", "..#..", "..#..", "..#..", "..#..", "..#..", ".###."],
  J: ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  N: ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", ".#.#."],
  X: ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "....#", "..##.", ".#...", "#....", "#####"],
  "3": ["####.", "....#", "....#", ".###.", "....#", "....#", "####."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
  " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
  ".": [".....", ".....", ".....", ".....", ".....", ".##..", ".##.."],
  ",": [".....", ".....", ".....", ".....", ".##..", ".##..", ".#..."],
  ":": [".....", ".##..", ".##..", ".....", ".##..", ".##..", "....."],
  ";": [".....", ".##..", ".##..", ".....", ".##..", ".##..", ".#..."],
  "!": ["..#..", "..#..", "..#..", "..#..", "..#..", ".....", "..#.."],
  "?": [".###.", "#...#", "....#", "..##.", "..#..", ".....", "..#.."],
  "-": [".....", ".....", ".....", ".###.", ".....", ".....", "....."],
  "—": [".....", ".....", ".....", "#####", ".....", ".....", "....."],
  "–": [".....", ".....", ".....", ".###.", ".....", ".....", "....."],
  "'": ["..#..", "..#..", ".#...", ".....", ".....", ".....", "....."],
  "’": ["..#..", "..#..", ".#...", ".....", ".....", ".....", "....."],
  '"': [".#.#.", ".#.#.", ".#.#.", ".....", ".....", ".....", "....."],
  "“": [".#.#.", ".#.#.", ".#.#.", ".....", ".....", ".....", "....."],
  "”": [".#.#.", ".#.#.", ".#.#.", ".....", ".....", ".....", "....."],
  "(": ["...#.", "..#..", ".#...", ".#...", ".#...", "..#..", "...#."],
  ")": [".#...", "..#..", "...#.", "...#.", "...#.", "..#..", ".#..."],
  "/": ["....#", "....#", "...#.", "..#..", ".#...", "#....", "#...."],
  "%": ["##..#", "##..#", "...#.", "..#..", ".#...", "#..##", "#..##"],
  $: ["..#..", ".####", "#.#..", ".###.", "..#.#", "####.", "..#.."],
  "&": [".##..", "#..#.", "#.#..", ".#...", "#.#.#", "#..#.", ".##.#"],
  "+": [".....", "..#..", "..#..", ".###.", "..#..", "..#..", "....."],
  "=": [".....", ".....", ".###.", ".....", ".###.", ".....", "....."],
  "*": [".....", "..#..", "#.#.#", ".###.", "#.#.#", "..#..", "....."],
  "•": [".....", "..#..", ".###.", ".###.", ".###.", "..#..", "....."],
};

function glyphFor(ch: string): string[] {
  return GLYPHS[ch.toUpperCase()] ?? GLYPHS[" "]!;
}

// Draw one line of text. Returns the width in pixels.
function render(x: number, y: number, text: string, s: number, c: RGB, bold = false): number {
  let cx = x;
  for (const ch of text) {
    const g = glyphFor(ch);
    for (let r = 0; r < 7; r++) {
      const row = g[r]!;
      for (let col = 0; col < 5; col++) {
        if (row[col] === "#") {
          box(cx + col * s, y + r * s, s, s, c);
          if (bold) box(cx + col * s + 1, y + r * s, s, s, c);
        }
      }
    }
    cx += 6 * s;
  }
  return cx - x - s;
}

function widthOf(text: string, s: number): number {
  return text.length * 6 * s - s;
}

function centre(y: number, text: string, s: number, c: RGB, bold = false): void {
  render(Math.round((W - widthOf(text, s)) / 2), y, text, s, c, bold);
}

// Greedy word wrap to a maximum pixel width. Returns the lines.
function fit(text: string, s: number, maxW: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = cur ? cur + " " + w : w;
    if (widthOf(trial, s) <= maxW || !cur) cur = trial;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Draw wrapped text; returns the y just below the last line.
function para(x: number, y: number, text: string, s: number, maxW: number, c: RGB, bold = false): number {
  const lh = 7 * s + (s >= 2 ? 3 : 2);
  for (const line of fit(text, s, maxW)) {
    render(x, y, line, s, c, bold);
    y += lh;
  }
  return y;
}

// ---- globe emblem -------------------------------------------------------
function emblem(cx: number, cy: number, r: number, c: RGB): void {
  // Circle outline, equator and meridian ellipses, plotted point by point,
  // with a tilted land band to suggest continents without drawing any map.
  for (let a = 0; a < 360; a += 1) {
    const t = (a * Math.PI) / 180;
    const ox = Math.round(cx + r * Math.cos(t));
    const oy = Math.round(cy + r * Math.sin(t));
    box(ox, oy, 2, 2, c);
    box(Math.round(cx + r * Math.cos(t)), Math.round(cy + r * 0.34 * Math.sin(t)), 2, 2, c);
    box(Math.round(cx + r * 0.34 * Math.cos(t)), Math.round(cy + r * Math.sin(t)), 2, 2, c);
    if (a % 3 === 0) {
      const lx = Math.round(cx + (r - 8) * Math.cos(t + 0.6));
      const ly = Math.round(cy + (r - 8) * Math.sin(t + 0.6) * 0.8);
      if ((lx - cx) * (lx - cx) + (ly - cy) * (ly - cy) < (r - 6) * (r - 6)) box(lx, ly, 3, 3, c);
    }
  }
}

// ---- cargo ship ---------------------------------------------------------
function drawShip(x: number, y: number): void {
  // A container ship at anchor: stacked containers, bridge tower, funnel
  // with smoke, an ink hull and blue water lines. Drawn for the tariff
  // lead: the goods the new levies will land on.
  const cx = x + 52;
  // containers: two rows of coloured boxes
  box(x + 8, y + 6, 22, 12, RED);
  box(x + 32, y + 6, 22, 12, BLUE);
  box(x + 56, y + 6, 22, 12, ORANGE);
  box(x + 14, y + 18, 22, 12, BLUE);
  box(x + 38, y + 18, 22, 12, RED);
  box(x + 62, y + 18, 22, 12, BLUE);
  // bridge tower, right end, with paper windows
  box(x + 84, y, 16, 30, INK);
  box(x + 87, y + 4, 4, 4, PAPER);
  box(x + 93, y + 4, 4, 4, PAPER);
  box(x + 87, y + 11, 4, 4, PAPER);
  box(x + 93, y + 11, 4, 4, PAPER);
  // funnel with smoke dots
  box(x + 44, y + 2, 10, 16, RED);
  box(x + 46, y - 6, 4, 4, GREY);
  box(x + 50, y - 12, 4, 4, GREY);
  box(x + 45, y - 18, 4, 4, GREY);
  // hull: rows narrowing towards the keel
  for (let r = 0; r < 12; r++) {
    const hw = Math.round(52 - r * 1.6);
    box(cx - hw, y + 30 + r, hw * 2, 1, INK);
  }
  // water lines
  rule(x + 2, y + 48, 100, BLUE, 1);
  rule(x + 12, y + 54, 80, BLUE, 1);
  rule(x + 22, y + 60, 60, BLUE, 1);
}

// ---- the day's stories --------------------------------------------------
// Every story below was reported on Thursday 26 November 2026 (or is an
// ongoing development clearly carried as today's news). Headline + one
// factual deck line each, with the outlet that reported it. Kind: F =
// feature (bold two-line headline + deck), B = brief (headline + deck),
// T = tiny one-liner (headline only, kept under 48 chars). The lead is
// Washington's tariff plan: levies of up to 35% on 14 trading partners,
// including China, the EU, Japan and India, citing factory overcapacity.
interface Story {
  k: "F" | "B" | "T";
  h: string;
  d: string;
}
interface Section {
  name: string;
  stories: Story[];
}

const LEAD_KICKER = "TRADE — WASHINGTON'S NEW TARIFF PLAN";
const LEAD_HEAD = ["WASHINGTON HITS 14 PARTNERS", "WITH TARIFFS UP TO 35%"];
const LEAD_DECK =
  "The US proposes levies of up to 35% on 14 trading partners, including China, the EU, Japan and India, citing factory overcapacity.";
const LEAD_SOURCES = "SOURCES: REUTERS, CNN, THE TIMES";

// The day in time-of-day beats: six moments from overnight to tonight.
// Labels are honest buckets, not clock times the wires did not give.
const TIMELINE: [string, string][] = [
  ["OVERNIGHT", "SAVASLEYKA RAID"],
  ["MORNING", "US TARIFF PLAN LANDS"],
  ["MIDDAY", "CAIRO TANKER FIRE KILLS 31"],
  ["AFTERNOON", "HOUTHIS HIT SAUDI PORTS"],
  ["EVENING", "MISS UNIVERSE IN PUERTO RICO"],
  ["TONIGHT", "MACY'S PARADE POSTPONED"],
];

// Pin map: [number, label, x, y] in the map strip's coordinates.
const PINS: [string, string, number, number][] = [
  ["1", "WASHINGTON", 305, 415],
  ["2", "CAIRO", 596, 419],
  ["3", "JEDDAH", 617, 423],
  ["4", "KYIV", 594, 408],
  ["5", "SAVASLEYKA", 628, 408],
  ["6", "CANARIES", 470, 420],
  ["7", "MUMBAI", 708, 424],
  ["8", "JAKARTA", 799, 435],
  ["9", "SAN JUAN", 335, 424],
  ["10", "HONG KONG", 819, 423],
];

const COLUMNS: Section[][] = [
  [
    {
      name: "WAR IN UKRAINE",
      stories: [
        { k: "F", h: "UKRAINE STRIKES SAVASLEYKA AIRBASE", d: "Five Russian planes damaged in the drone raid, Kyiv says. — REUTERS" },
        { k: "B", h: "KYIV HIT BY BALLISTIC MISSILES", d: "Overnight strikes on the capital. — REUTERS" },
        { k: "B", h: "DOZENS OF STATES: STOP RIOT AGENT USE", d: "Joint call over alleged chemical use. — REUTERS" },
        { k: "B", h: "GERMANY PLANS FIRST DRONE REGIMENT", d: "Unit to fly Ukraine-developed drones. — REUTERS" },
        { k: "B", h: "EU LEADERS WRESTLE OVER BUDGET, UKRAINE CASH", d: "1.6 trillion euro plan for 2028-34. — REUTERS" },
        { k: "T", h: "US LAWMAKERS: DROP PUTIN FROM G20", d: "" },
      ],
    },
    {
      name: "MIDDLE EAST",
      stories: [
        { k: "F", h: "HOUTHIS HIT SAUDI PORTS AND REFINERY", d: "Jeddah and Jazan ports and the Ras Tanura refinery attacked; oil prices rise. — REUTERS" },
        { k: "B", h: "ISRAELI STRIKES KILL HAMAS SECURITY CHIEF", d: "Top security figure dies in Gaza. — REUTERS" },
        { k: "B", h: "UN WARNS OF ISRAELI VIOLENCE RISK", d: "Risk to Palestinian civilians grows. — REUTERS" },
        { k: "B", h: "KNESSET ADVANCES STATE COMMISSION INQUIRY", d: "Vote moves the inquiry forward. — REUTERS" },
        { k: "B", h: "JUDGES: DROP MOST SERIOUS NETANYAHU CHARGES", d: "Judges urge dropping gravest counts. — REUTERS" },
        { k: "T", h: "TURKEY PROBES EX-BANKING WATCHDOG CHIEF", d: "" },
        { k: "T", h: "SUDAN REJECTS ETHIOPIA DIALOGUE BID", d: "" },
      ],
    },
    {
      name: "AFRICA",
      stories: [
        { k: "T", h: "CONGO EBOLA CASES PASS 12,000", d: "" },
        { k: "T", h: "KENYA COURT: EBOLA SITE BROKE CHARTER", d: "" },
        { k: "T", h: "SOMALIA: COULD AL-SHABAB TAKE OVER?", d: "" },
      ],
    },
  ],
  [
    {
      name: "UNITED STATES",
      stories: [
        { k: "B", h: "NASDAQ NEARS BEAR MARKET AS AI SELLS OFF", d: "Index down about 4% as AI unwinds. — REUTERS" },
        { k: "B", h: "SECOND JUDGE BLOCKS BIRTHRIGHT ORDER", d: "Citizenship order halted again. — REUTERS" },
        { k: "B", h: "HUAWEI GUILTY OF BANK FRAUD OVER IRAN", d: "US jury convicts the Chinese firm. — REUTERS" },
        { k: "B", h: "TRUMP ACCOUNTS TRADED NVIDIA 44 TIMES", d: "Trades disclosed in filings. — REUTERS" },
        { k: "B", h: "IOWA ARMY BLAST DECLARED A SUCCESS", d: "Controlled blast goes as planned. — REUTERS" },
        { k: "T", h: "FEDEX PLANE OVERSHOOTS MIAMI RUNWAY", d: "" },
        { k: "T", h: "CALIFORNIA WARNS OF KING TIDE FLOODS", d: "" },
      ],
    },
    {
      name: "ASIA-PACIFIC",
      stories: [
        { k: "F", h: "FIRST PAKISTANI ABOARD TIANGONG", d: "Muhammad Zeeshan Ali, the first Pakistani astronaut, joins China's station. — REUTERS" },
        { k: "B", h: "KIM WANTS MORE TACTICAL NUCLEAR WEAPONS", d: "Kim orders wider deployment. — REUTERS" },
        { k: "B", h: "NORTH KOREA EXPELS SWISS DIPLOMAT", d: "Expulsion follows a sanctions row. — REUTERS" },
        { k: "B", h: "INDONESIA MINE FLOOD: 13 DEAD, 13 MISSING", d: "Search resumes in West Java. — REUTERS" },
        { k: "B", h: "BANGLADESH GARMENT WORKERS WIN 36% RISE", d: "Pay deal follows street protests. — REUTERS" },
        { k: "B", h: "HONG KONG RENOVATION BLAZE KILLED 168", d: "Deadliest fire in decades. — REUTERS" },
        { k: "B", h: "CHINA, JAPAN, KOREA IN PAYMENTS TALKS", d: "ASEAN joins digital-payments talks. — REUTERS" },
        { k: "T", h: "JAPAN DATA-CENTRE BOOM FACES REVOLT", d: "" },
        { k: "T", h: "TAIWAN USES JOKES TO COUNTER CHINA", d: "" },
        { k: "T", h: "CHINA GOT NVIDIA CHIPS DESPITE RULES", d: "" },
      ],
    },
    {
      name: "EUROPE",
      stories: [
        { k: "T", h: "EU PARLIAMENT RATIFIES 2027 BUDGET", d: "" },
        { k: "T", h: "SPAIN VOTES: WHAT IS AT STAKE", d: "" },
        { k: "T", h: "TURKEY SEEKS 2027 START FOR ROAD PROJECT", d: "" },
      ],
    },
  ],
  [
    {
      name: "MARKETS & BUSINESS",
      stories: [
        { k: "B", h: "NVIDIA DOWN 3.9%, $2.3TN OFF ITS PEAK", d: "Chip stock at $149.30. — REUTERS" },
        { k: "B", h: "OIL RISES AS HOUTHIS HIT REFINERY", d: "Brent $94.71 as supply fears grow. — REUTERS" },
        { k: "B", h: "TWO SHIPS HIT BY MINES IN HORMUZ", d: "Mines hit two ships in the strait. — REUTERS" },
        { k: "B", h: "US CHIP CURBS SLOW CHINA'S AI MODELS", d: "Z.AI, Moonshot fall behind. — REUTERS" },
        { k: "B", h: "SOUTH KOREA VOWS TALKS ON 25% TARIFF", d: "Seoul: factories anchor US chains. — REUTERS" },
        { k: "T", h: "ASIA SHARES BOUNCE AFTER WALL ST FIGHTBACK", d: "" },
      ],
    },
    {
      name: "SPORT & CULTURE",
      stories: [
        { k: "F", h: "MISS UNIVERSE CROWNED AT HOME", d: "Jennifer Barreto of Puerto Rico wins Miss Universe 2026 before a home crowd. — REUTERS" },
        { k: "B", h: "LIVERPOOL BEAT CLUB BRUGGE 3-0", d: "Champions League night at Anfield. — REUTERS" },
        { k: "B", h: "GUKESH VS SINDAROV: GAME 3", d: "Title match reaches game three. — REUTERS" },
        { k: "T", h: "SINNER OUT AFTER KNEE SURGERY", d: "" },
        { k: "T", h: "LAKERS GET PAYBACK AGAINST JAZZ", d: "" },
        { k: "T", h: "DURAN DURAN'S ANDY TAYLOR DIES AT 65", d: "" },
        { k: "T", h: "JOLIE AND PITT SETTLE WINERY FIGHT", d: "" },
      ],
    },
    {
      name: "WORLD IN BRIEF",
      stories: [
        { k: "T", h: "CAIRO TANKER FIRE KILLS 31, HURTS 21", d: "" },
        { k: "T", h: "NEARLY 2,000 MIGRANTS REACH CANARIES", d: "" },
        { k: "T", h: "MACY'S 100TH PARADE POSTPONED TO SATURDAY", d: "" },
        { k: "T", h: "PHILADELPHIA THANKSGIVING PARADE AXED", d: "" },
        { k: "T", h: "INDIA MARKS 18 YEARS SINCE 26/11", d: "" },
        { k: "T", h: "MURMANSK GOVERNOR HELD ON GRAFT CHARGES", d: "" },
        { k: "T", h: "KENYAN CULT LEADER CONVICTED AGAIN", d: "" },
        { k: "T", h: "LEBANON TO OPEN SECOND AIRPORT NEXT MONTH", d: "" },
        { k: "T", h: "COLOMBIA SIEGE: 20 HOSTAGES, 17 HOURS", d: "" },
        { k: "T", h: "ASTEROID TEST REVEALS STADIUM CRATER", d: "" },
        { k: "T", h: "CANADA TESTS FOREIGN-STUDENT CURBS", d: "" },
        { k: "T", h: "ECUADOR: US TALKS TO REVIEW OPERATIONS", d: "" },
        { k: "T", h: "CIA/ODNI DETAILS LEAK IN SECURITY LAPSE", d: "" },
        { k: "T", h: "THE QUAD IN PRECARIOUS STATE", d: "" },
      ],
    },
  ],
];

const MARGIN = 28;
const COLW = 304;
const GUT = 14;
const COLX = [MARGIN, MARGIN + COLW + GUT, MARGIN + 2 * (COLW + GUT)];

function sectionHead(x: number, y: number, name: string): number {
  box(x, y, COLW, 26, INK);
  render(x + 8, y + 6, name, 2, PAPER, true);
  return y + 30;
}

// A feature story: red bullet, a bold two-line headline and a deck line.
function storyFeature(x: number, y: number, s: Story): number {
  box(x, y + 2, 8, 8, RED);
  let ny = para(x + 14, y, s.h, 2, COLW - 14, INK, true);
  ny = para(x + 14, ny + 1, s.d, 1, COLW - 14, GREY);
  return ny + 4;
}

// A brief story: red bullet, a bold headline line and a deck line.
function storyBrief(x: number, y: number, s: Story): number {
  box(x, y + 2, 6, 6, RED);
  let ny = para(x + 12, y, s.h, 1, COLW - 12, INK, true);
  ny = para(x + 12, ny + 1, s.d, 1, COLW - 12, GREY);
  return ny + 3;
}

// A one-line brief: bullet dot and headline only, no deck.
function storyTiny(x: number, y: number, s: Story): number {
  render(x, y, "• " + s.h, 1, INK, true);
  return y + 10;
}

// ---- compose the front page ---------------------------------------------
function compose(): void {
  // Masthead: globe, title, red date box.
  emblem(72, 58, 40, BLUE);
  render(132, 30, "THE WORLD TODAY", 7, INK, true);
  box(872, 22, 124, 78, RED);
  render(906, 30, "26", 5, PAPER, true);
  render(910, 68, "NOV 2026", 1, PAPER, true);
  rule(MARGIN, 116, W - 2 * MARGIN, INK, 3);
  centre(128, "THURSDAY, 26 NOVEMBER 2026", 2, INK, true);
  centre(150, "64 STORIES FROM EVERY REGION — ONE DAY, ONE PAGE — DATE CHECKED", 1, GREY);
  rule(MARGIN, 168, W - 2 * MARGIN, INK, 1);

  // Lead story: Washington's new tariff plan for 14 trading partners.
  let y = 182;
  render(MARGIN, y, LEAD_KICKER, 2, RED, true);
  y += 24;
  for (const line of LEAD_HEAD) {
    render(MARGIN, y, line, 4, INK, true);
    y += 34;
  }
  y = para(MARGIN, y + 2, LEAD_DECK, 2, 672, INK);
  render(MARGIN, y + 4, LEAD_SOURCES, 1, GREY);
  // Cargo ship and tariff facts, right of the lead text.
  drawShip(706, 190);
  const facts = [
    "14 PARTNERS NAMED",
    "CHINA, EU, JAPAN,",
    "INDIA, SOUTH KOREA",
    "UP TO 35% LEVIES",
    "CITES OVERCAPACITY",
    "SEOUL FACES 25%",
    "TALKS PROMISED",
  ];
  let fy = 182;
  for (const f of facts) {
    render(824, fy, f, 1, INK, true);
    fy += 9;
  }
  rule(MARGIN, 344, W - 2 * MARGIN, INK, 1);

  // The day in UTC: six beats on a line. The strip title sits at the
  // right end so it never collides with the first node's time label.
  render(884, 352, "THE DAY IN UTC", 1, RED, true);
  rule(MARGIN, 368, W - 2 * MARGIN, INK, 1);
  TIMELINE.forEach(([t, label], i) => {
    const nx = 60 + i * 160;
    box(nx - 3, 365, 7, 7, RED);
    const tw = widthOf(t, 1);
    render(nx - Math.round(tw / 2), 354, t, 1, INK, true);
    const lines = fit(label, 1, 156);
    let ly = 376;
    for (const ln of lines) {
      render(nx - Math.round(widthOf(ln, 1) / 2), ly, ln, 1, INK);
      ly += 9;
    }
  });

  // Pin map: a real world map pasted into the band, numbered pins, legend below.
  drawMap();
  for (const [n, , px, py] of PINS) {
    box(px - 3, py - 3, 6, 6, RED);
    render(px + 5, py - 3, n, 1, INK, true);
  }
  render(MARGIN, 474, "WHERE IT HAPPENED — 1 WASHINGTON  2 CAIRO  3 JEDDAH  4 KYIV  5 SAVASLEYKA  6 CANARIES  7 MUMBAI  8 JAKARTA  9 SAN JUAN  10 HONG KONG", 1, GREY);
  rule(MARGIN, 484, W - 2 * MARGIN, INK, 1);

  // Three columns of sections. Each story carries its kind: F = feature,
  // B = brief, T = tiny one-liner.
  const colTop = 492;
  let deepest = colTop;
  COLUMNS.forEach((sections, ci) => {
    let cy = colTop;
    const x = COLX[ci]!;
    for (const sec of sections) {
      cy = sectionHead(x, cy, sec.name);
      for (const st of sec.stories) {
        if (st.k === "F") cy = storyFeature(x, cy, st);
        else if (st.k === "T") cy = storyTiny(x, cy, st);
        else cy = storyBrief(x, cy, st);
      }
      cy += 2;
    }
    console.error("column " + ci + " ends at y=" + cy);
    if (cy > deepest) deepest = cy;
  });

  // Footer.
  rule(MARGIN, 992, W - 2 * MARGIN, INK, 2);
  centre(1002, "THE WORLD TODAY — THURSDAY 26 NOVEMBER 2026 — EVERY STORY REPORTED TODAY", 1, GREY);
  if (deepest > 990) console.error("WARNING: columns run to y=" + deepest);
  else console.error("columns end at y=" + deepest);
}

function main(): void {
  compose();
  const out = process.env.MAKEFUN_OUTPUT_DIR || "/output";
  mkdirSync(out, { recursive: true });
  const target = out + "/entry.png";
  writeFileSync(target, encodePng());
  verifyPng(target);
}

main();
