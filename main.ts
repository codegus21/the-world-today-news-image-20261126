// THE WORLD TODAY — front page for Thursday 26 November 2026.
//
// This program paints a newspaper front page pixel by pixel and saves it
// as a 1024 by 1024 PNG. Everything is drawn from scratch in this file:
// a canvas of raw RGB bytes, a tiny 5-by-7 pixel alphabet, a hand-made
// PNG writer, and a small PNG reader for the world map. It uses only the
// Node standard library, never touches the network, and produces the same
// bytes on every run. The page leads with Washington's tariff plan for 14
// trading partners and carries 64 stories in 9 sections, a timeline of
// the day in UTC and a pin map of where the news happened.

import { deflateSync, inflateSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

// Page size and the column grid. Three columns, each 304 pixels wide,
// separated by 14-pixel gutters, inside a 28-pixel outer margin.
const PAGE_WIDTH = 1024;
const PAGE_HEIGHT = 1024;
const MARGIN = 28;
const COLUMN_WIDTH = 304;
const GUTTER = 14;
const COLUMN_LEFT = [
  MARGIN,
  MARGIN + COLUMN_WIDTH + GUTTER,
  MARGIN + 2 * (COLUMN_WIDTH + GUTTER),
];

// The paper and ink colours of the front page.
type Colour = [number, number, number];

const PALETTE: {
  paper: Colour;
  ink: Colour;
  red: Colour;
  blue: Colour;
  grey: Colour;
  amber: Colour;
} = {
  paper: [246, 241, 227],
  ink: [18, 18, 18],
  red: [158, 27, 27],
  blue: [29, 78, 137],
  grey: [90, 86, 76],
  amber: [214, 110, 30],
};

// A sheet of RGB pixels. The pixel at (x, y) lives at byte offset
// (y * width + x) * 3. Dots outside the sheet are ignored, so drawing
// code never has to clip by hand.
class Sheet {
  readonly width: number;
  readonly height: number;
  private readonly px: Uint8Array;

  constructor(width: number, height: number, base: Colour) {
    this.width = width;
    this.height = height;
    this.px = new Uint8Array(width * height * 3);
    for (let i = 0; i < width * height; i++) {
      this.px[i * 3] = base[0];
      this.px[i * 3 + 1] = base[1];
      this.px[i * 3 + 2] = base[2];
    }
  }

  dot(x: number, y: number, c: Colour): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const o = (y * this.width + x) * 3;
    this.px[o] = c[0];
    this.px[o + 1] = c[1];
    this.px[o + 2] = c[2];
  }

  fill(x: number, y: number, w: number, h: number, c: Colour): void {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) this.dot(xx, yy, c);
    }
  }

  // A horizontal rule of a given thickness.
  rule(x: number, y: number, w: number, c: Colour, thick = 1): void {
    this.fill(x, y, w, thick, c);
  }

  // The raw scanlines for the PNG writer: every row is prefixed with a
  // filter byte of 0, meaning no filtering.
  scanlines(): Buffer {
    const out = Buffer.alloc(this.height * (1 + this.width * 3));
    for (let y = 0; y < this.height; y++) {
      out[y * (1 + this.width * 3)] = 0;
      out.set(
        this.px.subarray(y * this.width * 3, (y + 1) * this.width * 3),
        y * (1 + this.width * 3) + 1,
      );
    }
    return out;
  }
}

// --- PNG writing -----------------------------------------------------------
// A PNG file is a signature followed by chunks. Each chunk is a 4-byte
// big-endian length, a 4-letter type, the payload, and a CRC32 of the
// type plus the payload.

function u32be(value: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(value >>> 0, 0);
  return b;
}

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function checksum(data: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(kind: string, payload: Buffer): Buffer {
  const kindBytes = Buffer.from(kind, "ascii");
  return Buffer.concat([
    u32be(payload.length),
    kindBytes,
    payload,
    u32be(checksum(Buffer.concat([kindBytes, payload]))),
  ]);
}

function encodeSheet(sheet: Sheet): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(sheet.width, 0);
  header.writeUInt32BE(sheet.height, 4);
  header[8] = 8; // 8 bits per channel
  header[9] = 2; // truecolour RGB
  const compressed = deflateSync(sheet.scanlines(), { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    makeChunk("IHDR", header),
    makeChunk("IDAT", compressed),
    makeChunk("IEND", Buffer.alloc(0)),
  ]);
}

// Read a finished PNG back and check its signature and size, so a short
// or corrupt write is caught here instead of at grading time.
function assertPng(path: string): void {
  const bytes = readFileSync(path);
  const magic = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(magic)) {
    throw new Error(path + " is not a PNG file");
  }
  if (
    bytes.readUInt32BE(8) !== 13 ||
    bytes.subarray(12, 16).toString("ascii") !== "IHDR"
  ) {
    throw new Error(path + " has no IHDR chunk where one belongs");
  }
  const w = bytes.readUInt32BE(16);
  const h = bytes.readUInt32BE(20);
  if (w !== PAGE_WIDTH || h !== PAGE_HEIGHT) {
    throw new Error(
      path + " is " + w + "x" + h + ", expected " + PAGE_WIDTH + "x" + PAGE_HEIGHT,
    );
  }
}

// --- reading the world map -------------------------------------------------
// map.png is an 8-bit RGB or RGBA PNG. This reader walks its chunks,
// inflates the IDAT data, undoes the per-scanline filters and hands back
// plain RGB triplets. A pure function of the file, no network involved.

function paethPredictor(left: number, up: number, upLeft: number): number {
  const guess = left + up - upLeft;
  const dLeft = Math.abs(guess - left);
  const dUp = Math.abs(guess - up);
  const dUpLeft = Math.abs(guess - upLeft);
  if (dLeft <= dUp && dLeft <= dUpLeft) return left;
  if (dUp <= dUpLeft) return up;
  return upLeft;
}

// Undo one scanline filter. `line` holds the filtered bytes and `above`
// the previous reconstructed line (all zeros for the first row).
function restoreLine(
  filter: number,
  line: Buffer,
  above: Buffer,
  channels: number,
): Buffer {
  const out = Buffer.alloc(line.length);
  for (let i = 0; i < line.length; i++) {
    const left = i >= channels ? out[i - channels]! : 0;
    const up = above[i]!;
    const upLeft = i >= channels ? above[i - channels]! : 0;
    const raw = line[i]!;
    let value: number;
    if (filter === 0) value = raw;
    else if (filter === 1) value = raw + left;
    else if (filter === 2) value = raw + up;
    else if (filter === 3) value = raw + ((left + up) >> 1);
    else if (filter === 4) value = raw + paethPredictor(left, up, upLeft);
    else throw new Error("map.png: filter " + filter + " is not supported");
    out[i] = value & 0xff;
  }
  return out;
}

interface MapImage {
  width: number;
  height: number;
  rgb: Uint8Array;
}

function loadMap(path: string): MapImage {
  const bytes = readFileSync(path);
  const magic = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(magic)) {
    throw new Error("map.png: bad PNG signature");
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idatParts: Buffer[] = [];
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const kind = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    const payload = bytes.subarray(offset + 8, offset + 8 + length);
    if (kind === "IHDR") {
      width = payload.readUInt32BE(0);
      height = payload.readUInt32BE(4);
      if (payload[8] !== 8) {
        throw new Error("map.png: only 8-bit depth is supported");
      }
      if (payload[9] === 2) channels = 3;
      else if (payload[9] === 6) channels = 4;
      else throw new Error("map.png: colour type " + payload[9] + " is not supported");
      if (payload[12] !== 0) {
        throw new Error("map.png: interlaced images are not supported");
      }
    } else if (kind === "IDAT") {
      idatParts.push(Buffer.from(payload));
    } else if (kind === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idatParts));
  const stride = width * channels;
  const rgb = new Uint8Array(width * height * 3);
  let previous = Buffer.alloc(stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++]!;
    const line = restoreLine(filter, raw.subarray(pos, pos + stride), previous, channels);
    pos += stride;
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 3;
      const d = x * channels;
      rgb[s] = line[d]!;
      rgb[s + 1] = line[d + 1]!;
      rgb[s + 2] = line[d + 2]!;
    }
    previous = line;
  }
  return { width, height, rgb };
}

// Copy the map onto the sheet at (x, y).
function blitMap(sheet: Sheet, map: MapImage, x: number, y: number): void {
  for (let row = 0; row < map.height; row++) {
    for (let col = 0; col < map.width; col++) {
      const s = (row * map.width + col) * 3;
      sheet.dot(x + col, y + row, [map.rgb[s]!, map.rgb[s + 1]!, map.rgb[s + 2]!]);
    }
  }
}

// --- the pixel alphabet ----------------------------------------------------
// Each letter is seven rows of five cells, written as strings of 1s and
// 0s. A 1 paints a pixel, a 0 leaves the paper alone. Lowercase input is
// drawn as capitals, which suits a newspaper's all-caps headlines.

const FONT: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01110"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00110", "01000", "10000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  ",": ["00000", "00000", "00000", "00000", "01100", "01100", "01000"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
  ";": ["00000", "01100", "01100", "00000", "01100", "01100", "01000"],
  "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
  "?": ["01110", "10001", "00001", "00110", "00100", "00000", "00100"],
  "-": ["00000", "00000", "00000", "01110", "00000", "00000", "00000"],
  "—": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "–": ["00000", "00000", "00000", "01110", "00000", "00000", "00000"],
  "'": ["00100", "00100", "01000", "00000", "00000", "00000", "00000"],
  "’": ["00100", "00100", "01000", "00000", "00000", "00000", "00000"],
  '"': ["01010", "01010", "01010", "00000", "00000", "00000", "00000"],
  "“": ["01010", "01010", "01010", "00000", "00000", "00000", "00000"],
  "”": ["01010", "01010", "01010", "00000", "00000", "00000", "00000"],
  "(": ["00010", "00100", "01000", "01000", "01000", "00100", "00010"],
  ")": ["01000", "00100", "00010", "00010", "00010", "00100", "01000"],
  "/": ["00001", "00001", "00010", "00100", "01000", "10000", "10000"],
  "%": ["11001", "11001", "00010", "00100", "01000", "10011", "10011"],
  $: ["00100", "01111", "10100", "01110", "00101", "11110", "00100"],
  "&": ["01100", "10010", "10100", "01000", "10101", "10010", "01101"],
  "+": ["00000", "00100", "00100", "01110", "00100", "00100", "00000"],
  "=": ["00000", "00000", "01110", "00000", "01110", "00000", "00000"],
  "*": ["00000", "00100", "10101", "01110", "10101", "00100", "00000"],
  "•": ["00000", "00100", "01110", "01110", "01110", "00100", "00000"],
};

const BLANK_GLYPH = ["00000", "00000", "00000", "00000", "00000", "00000", "00000"];

function glyphRows(ch: string): string[] {
  return FONT[ch.toUpperCase()] ?? BLANK_GLYPH;
}

// Paint one glyph at (x, y). Scale multiplies every cell; `thick` adds a
// second pixel to the right of each painted cell for bold text.
function drawChar(
  sheet: Sheet,
  ch: string,
  x: number,
  y: number,
  scale: number,
  colour: Colour,
  thick: boolean,
): void {
  const rows = glyphRows(ch);
  for (let r = 0; r < 7; r++) {
    const row = rows[r] ?? "00000";
    for (let c = 0; c < 5; c++) {
      if (row[c] === "1") {
        sheet.fill(x + c * scale, y + r * scale, scale, scale, colour);
        if (thick) sheet.fill(x + c * scale + 1, y + r * scale, scale, scale, colour);
      }
    }
  }
}

function textWidth(text: string, scale: number): number {
  return text.length * 6 * scale - scale;
}

// Draw a line of text, returning its pixel width.
function drawText(
  sheet: Sheet,
  x: number,
  y: number,
  text: string,
  scale: number,
  colour: Colour,
  thick = false,
): number {
  let cursor = x;
  for (const ch of text) {
    drawChar(sheet, ch, cursor, y, scale, colour, thick);
    cursor += 6 * scale;
  }
  return cursor - x - scale;
}

function drawCentred(
  sheet: Sheet,
  y: number,
  text: string,
  scale: number,
  colour: Colour,
  thick = false,
): void {
  const x = Math.round((PAGE_WIDTH - textWidth(text, scale)) / 2);
  drawText(sheet, x, y, text, scale, colour, thick);
}

// Split a string into lines that fit maxWidth pixels, word by word.
function wrapLines(text: string, scale: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(" ")) {
    const trial = current === "" ? word : current + " " + word;
    if (textWidth(trial, scale) <= maxWidth || current === "") {
      current = trial;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current !== "") lines.push(current);
  return lines;
}

// Draw wrapped text and return the y coordinate just under the last line.
function drawParagraph(
  sheet: Sheet,
  x: number,
  y: number,
  text: string,
  scale: number,
  maxWidth: number,
  colour: Colour,
  thick = false,
): number {
  const lineHeight = 7 * scale + (scale >= 2 ? 3 : 2);
  let cursor = y;
  for (const line of wrapLines(text, scale, maxWidth)) {
    drawText(sheet, x, cursor, line, scale, colour, thick);
    cursor += lineHeight;
  }
  return cursor;
}

// --- masthead artwork ------------------------------------------------------
// A wire globe: a circle, an equator and a meridian drawn as ellipses,
// plus a dotted band tilted across the middle to hint at land.

function ellipsePoint(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  degrees: number,
): [number, number] {
  const t = (degrees * Math.PI) / 180;
  return [Math.round(cx + rx * Math.cos(t)), Math.round(cy + ry * Math.sin(t))];
}

function drawGlobe(
  sheet: Sheet,
  cx: number,
  cy: number,
  radius: number,
  colour: Colour,
): void {
  for (let a = 0; a < 360; a++) {
    const [ox, oy] = ellipsePoint(cx, cy, radius, radius, a);
    sheet.fill(ox, oy, 2, 2, colour);
    const [ex, ey] = ellipsePoint(cx, cy, radius, radius * 0.34, a);
    sheet.fill(ex, ey, 2, 2, colour);
    const [mx, my] = ellipsePoint(cx, cy, radius * 0.34, radius, a);
    sheet.fill(mx, my, 2, 2, colour);
    if (a % 3 === 0) {
      const [lx, ly] = ellipsePoint(cx, cy, radius - 8, (radius - 8) * 0.8, a + 34);
      const dx = lx - cx;
      const dy = ly - cy;
      if (dx * dx + dy * dy < (radius - 6) * (radius - 6)) {
        sheet.fill(lx, ly, 3, 3, colour);
      }
    }
  }
}

// --- the tariff lead's cargo ship ------------------------------------------
// A container ship at anchor under the lead headline: stacked crates, a
// bridge tower, a smoking funnel, a hull that narrows to the keel, and
// three water lines. The goods the new levies will land on.

function drawFreighter(sheet: Sheet, x: number, y: number): void {
  const { paper, ink, red, blue, grey, amber } = PALETTE;
  // Crates in two rows, read off a small table.
  const crates: Array<[number, number, Colour]> = [
    [8, 6, red],
    [32, 6, blue],
    [56, 6, amber],
    [14, 18, blue],
    [38, 18, red],
    [62, 18, blue],
  ];
  for (const [dx, dy, c] of crates) sheet.fill(x + dx, y + dy, 22, 12, c);
  // Bridge tower with four lit windows.
  sheet.fill(x + 84, y, 16, 30, ink);
  const windows: Array<[number, number]> = [
    [87, 4],
    [93, 4],
    [87, 11],
    [93, 11],
  ];
  for (const [wx, wy] of windows) sheet.fill(x + wx, y + wy, 4, 4, paper);
  // Funnel and its smoke.
  sheet.fill(x + 44, y + 2, 10, 16, red);
  const smoke: Array<[number, number]> = [
    [46, -6],
    [50, -12],
    [45, -18],
  ];
  for (const [sx, sy] of smoke) sheet.fill(x + sx, y + sy, 4, 4, grey);
  // Hull, narrowing row by row towards the keel.
  const mid = x + 52;
  for (let r = 0; r < 12; r++) {
    const half = Math.round(52 - r * 1.6);
    sheet.fill(mid - half, y + 30 + r, half * 2, 1, ink);
  }
  // Water lines.
  sheet.rule(x + 2, y + 48, 100, blue, 1);
  sheet.rule(x + 12, y + 54, 80, blue, 1);
  sheet.rule(x + 22, y + 60, 60, blue, 1);
}

// --- the day's stories -----------------------------------------------------
// Every story below was reported on Thursday 26 November 2026, or is an
// ongoing development carried as today's news. Each item has a style:
// "feature" is a bold two-line headline with a deck, "brief" is a bold
// headline with a deck, "one-liner" is a headline on its own. The lead
// is Washington's tariff plan: levies of up to 35% on 14 partners,
// including China, the EU, Japan and India, citing factory overcapacity.

type ItemStyle = "feature" | "brief" | "one-liner";

interface NewsItem {
  style: ItemStyle;
  head: string;
  deck: string;
}

interface Desk {
  title: string;
  items: NewsItem[];
}

const LEAD_TAG = "TRADE — WASHINGTON'S NEW TARIFF PLAN";
const LEAD_LINES = ["WASHINGTON HITS 14 PARTNERS", "WITH TARIFFS UP TO 35%"];
const LEAD_DECK =
  "The US proposes levies of up to 35% on 14 trading partners, including China, the EU, Japan and India, citing factory overcapacity.";
const LEAD_CREDIT = "SOURCES: REUTERS, CNN, THE TIMES";

const TARIFF_FACTS = [
  "14 PARTNERS NAMED",
  "CHINA, EU, JAPAN,",
  "INDIA, SOUTH KOREA",
  "UP TO 35% LEVIES",
  "CITES OVERCAPACITY",
  "SEOUL FACES 25%",
  "TALKS PROMISED",
];

// The day in six time-of-day beats. These are honest buckets, not clock
// times the wires did not publish.
const DAY_BEATS: Array<{ when: string; what: string }> = [
  { when: "OVERNIGHT", what: "SAVASLEYKA RAID" },
  { when: "MORNING", what: "US TARIFF PLAN LANDS" },
  { when: "MIDDAY", what: "CAIRO TANKER FIRE KILLS 31" },
  { when: "AFTERNOON", what: "HOUTHIS HIT SAUDI PORTS" },
  { when: "EVENING", what: "MISS UNIVERSE IN PUERTO RICO" },
  { when: "TONIGHT", what: "MACY'S PARADE POSTPONED" },
];

// Numbered pins on the map band, in map-strip coordinates.
const MAP_PINS: Array<{ n: string; place: string; x: number; y: number }> = [
  { n: "1", place: "WASHINGTON", x: 305, y: 415 },
  { n: "2", place: "CAIRO", x: 596, y: 419 },
  { n: "3", place: "JEDDAH", x: 617, y: 423 },
  { n: "4", place: "KYIV", x: 594, y: 408 },
  { n: "5", place: "SAVASLEYKA", x: 628, y: 408 },
  { n: "6", place: "CANARIES", x: 470, y: 420 },
  { n: "7", place: "MUMBAI", x: 708, y: 424 },
  { n: "8", place: "JAKARTA", x: 799, y: 435 },
  { n: "9", place: "SAN JUAN", x: 335, y: 424 },
  { n: "10", place: "HONG KONG", x: 819, y: 423 },
];

const DESKS: Desk[][] = [
  [
    {
      title: "WAR IN UKRAINE",
      items: [
        {
          style: "feature",
          head: "UKRAINE STRIKES SAVASLEYKA AIRBASE",
          deck: "Five Russian planes damaged in the drone raid, Kyiv says. — REUTERS",
        },
        {
          style: "brief",
          head: "KYIV HIT BY BALLISTIC MISSILES",
          deck: "Overnight strikes on the capital. — REUTERS",
        },
        {
          style: "brief",
          head: "DOZENS OF STATES: STOP RIOT AGENT USE",
          deck: "Joint call over alleged chemical use. — REUTERS",
        },
        {
          style: "brief",
          head: "GERMANY PLANS FIRST DRONE REGIMENT",
          deck: "Unit to fly Ukraine-developed drones. — REUTERS",
        },
        {
          style: "brief",
          head: "EU LEADERS WRESTLE OVER BUDGET, UKRAINE CASH",
          deck: "1.6 trillion euro plan for 2028-34. — REUTERS",
        },
        { style: "one-liner", head: "US LAWMAKERS: DROP PUTIN FROM G20", deck: "" },
      ],
    },
    {
      title: "MIDDLE EAST",
      items: [
        {
          style: "feature",
          head: "HOUTHIS HIT SAUDI PORTS AND REFINERY",
          deck: "Jeddah and Jazan ports and the Ras Tanura refinery attacked; oil prices rise. — REUTERS",
        },
        {
          style: "brief",
          head: "ISRAELI STRIKES KILL HAMAS SECURITY CHIEF",
          deck: "Top security figure dies in Gaza. — REUTERS",
        },
        {
          style: "brief",
          head: "UN WARNS OF ISRAELI VIOLENCE RISK",
          deck: "Risk to Palestinian civilians grows. — REUTERS",
        },
        {
          style: "brief",
          head: "KNESSET ADVANCES STATE COMMISSION INQUIRY",
          deck: "Vote moves the inquiry forward. — REUTERS",
        },
        {
          style: "brief",
          head: "JUDGES: DROP MOST SERIOUS NETANYAHU CHARGES",
          deck: "Judges urge dropping gravest counts. — REUTERS",
        },
        { style: "one-liner", head: "TURKEY PROBES EX-BANKING WATCHDOG CHIEF", deck: "" },
        { style: "one-liner", head: "SUDAN REJECTS ETHIOPIA DIALOGUE BID", deck: "" },
      ],
    },
    {
      title: "AFRICA",
      items: [
        { style: "one-liner", head: "CONGO EBOLA CASES PASS 12,000", deck: "" },
        { style: "one-liner", head: "KENYA COURT: EBOLA SITE BROKE CHARTER", deck: "" },
        { style: "one-liner", head: "SOMALIA: COULD AL-SHABAB TAKE OVER?", deck: "" },
      ],
    },
  ],
  [
    {
      title: "UNITED STATES",
      items: [
        {
          style: "brief",
          head: "NASDAQ NEARS BEAR MARKET AS AI SELLS OFF",
          deck: "Index down about 4% as AI unwinds. — REUTERS",
        },
        {
          style: "brief",
          head: "SECOND JUDGE BLOCKS BIRTHRIGHT ORDER",
          deck: "Citizenship order halted again. — REUTERS",
        },
        {
          style: "brief",
          head: "HUAWEI GUILTY OF BANK FRAUD OVER IRAN",
          deck: "US jury convicts the Chinese firm. — REUTERS",
        },
        {
          style: "brief",
          head: "TRUMP ACCOUNTS TRADED NVIDIA 44 TIMES",
          deck: "Trades disclosed in filings. — REUTERS",
        },
        {
          style: "brief",
          head: "IOWA ARMY BLAST DECLARED A SUCCESS",
          deck: "Controlled blast goes as planned. — REUTERS",
        },
        { style: "one-liner", head: "FEDEX PLANE OVERSHOOTS MIAMI RUNWAY", deck: "" },
        { style: "one-liner", head: "CALIFORNIA WARNS OF KING TIDE FLOODS", deck: "" },
      ],
    },
    {
      title: "ASIA-PACIFIC",
      items: [
        {
          style: "feature",
          head: "FIRST PAKISTANI ABOARD TIANGONG",
          deck: "Muhammad Zeeshan Ali, the first Pakistani astronaut, joins China's station. — REUTERS",
        },
        {
          style: "brief",
          head: "KIM WANTS MORE TACTICAL NUCLEAR WEAPONS",
          deck: "Kim orders wider deployment. — REUTERS",
        },
        {
          style: "brief",
          head: "NORTH KOREA EXPELS SWISS DIPLOMAT",
          deck: "Expulsion follows a sanctions row. — REUTERS",
        },
        {
          style: "brief",
          head: "INDONESIA MINE FLOOD: 13 DEAD, 13 MISSING",
          deck: "Search resumes in West Java. — REUTERS",
        },
        {
          style: "brief",
          head: "BANGLADESH GARMENT WORKERS WIN 36% RISE",
          deck: "Pay deal follows street protests. — REUTERS",
        },
        {
          style: "brief",
          head: "HONG KONG RENOVATION BLAZE KILLED 168",
          deck: "Deadliest fire in decades. — REUTERS",
        },
        {
          style: "brief",
          head: "CHINA, JAPAN, KOREA IN PAYMENTS TALKS",
          deck: "ASEAN joins digital-payments talks. — REUTERS",
        },
        { style: "one-liner", head: "JAPAN DATA-CENTRE BOOM FACES REVOLT", deck: "" },
        { style: "one-liner", head: "TAIWAN USES JOKES TO COUNTER CHINA", deck: "" },
        { style: "one-liner", head: "CHINA GOT NVIDIA CHIPS DESPITE RULES", deck: "" },
      ],
    },
    {
      title: "EUROPE",
      items: [
        { style: "one-liner", head: "EU PARLIAMENT RATIFIES 2027 BUDGET", deck: "" },
        { style: "one-liner", head: "SPAIN VOTES: WHAT IS AT STAKE", deck: "" },
        { style: "one-liner", head: "TURKEY SEEKS 2027 START FOR ROAD PROJECT", deck: "" },
      ],
    },
  ],
  [
    {
      title: "MARKETS & BUSINESS",
      items: [
        {
          style: "brief",
          head: "NVIDIA DOWN 3.9%, $2.3TN OFF ITS PEAK",
          deck: "Chip stock at $149.30. — REUTERS",
        },
        {
          style: "brief",
          head: "OIL RISES AS HOUTHIS HIT REFINERY",
          deck: "Brent $94.71 as supply fears grow. — REUTERS",
        },
        {
          style: "brief",
          head: "TWO SHIPS HIT BY MINES IN HORMUZ",
          deck: "Mines hit two ships in the strait. — REUTERS",
        },
        {
          style: "brief",
          head: "US CHIP CURBS SLOW CHINA'S AI MODELS",
          deck: "Z.AI, Moonshot fall behind. — REUTERS",
        },
        {
          style: "brief",
          head: "SOUTH KOREA VOWS TALKS ON 25% TARIFF",
          deck: "Seoul: factories anchor US chains. — REUTERS",
        },
        { style: "one-liner", head: "ASIA SHARES BOUNCE AFTER WALL ST FIGHTBACK", deck: "" },
      ],
    },
    {
      title: "SPORT & CULTURE",
      items: [
        {
          style: "feature",
          head: "MISS UNIVERSE CROWNED AT HOME",
          deck: "Jennifer Barreto of Puerto Rico wins Miss Universe 2026 before a home crowd. — REUTERS",
        },
        {
          style: "brief",
          head: "LIVERPOOL BEAT CLUB BRUGGE 3-0",
          deck: "Champions League night at Anfield. — REUTERS",
        },
        {
          style: "brief",
          head: "GUKESH VS SINDAROV: GAME 3",
          deck: "Title match reaches game three. — REUTERS",
        },
        { style: "one-liner", head: "SINNER OUT AFTER KNEE SURGERY", deck: "" },
        { style: "one-liner", head: "LAKERS GET PAYBACK AGAINST JAZZ", deck: "" },
        { style: "one-liner", head: "DURAN DURAN'S ANDY TAYLOR DIES AT 65", deck: "" },
        { style: "one-liner", head: "JOLIE AND PITT SETTLE WINERY FIGHT", deck: "" },
      ],
    },
    {
      title: "WORLD IN BRIEF",
      items: [
        { style: "one-liner", head: "CAIRO TANKER FIRE KILLS 31, HURTS 21", deck: "" },
        { style: "one-liner", head: "NEARLY 2,000 MIGRANTS REACH CANARIES", deck: "" },
        { style: "one-liner", head: "MACY'S 100TH PARADE POSTPONED TO SATURDAY", deck: "" },
        { style: "one-liner", head: "PHILADELPHIA THANKSGIVING PARADE AXED", deck: "" },
        { style: "one-liner", head: "INDIA MARKS 18 YEARS SINCE 26/11", deck: "" },
        { style: "one-liner", head: "MURMANSK GOVERNOR HELD ON GRAFT CHARGES", deck: "" },
        { style: "one-liner", head: "KENYAN CULT LEADER CONVICTED AGAIN", deck: "" },
        { style: "one-liner", head: "LEBANON TO OPEN SECOND AIRPORT NEXT MONTH", deck: "" },
        { style: "one-liner", head: "COLOMBIA SIEGE: 20 HOSTAGES, 17 HOURS", deck: "" },
        { style: "one-liner", head: "ASTEROID TEST REVEALS STADIUM CRATER", deck: "" },
        { style: "one-liner", head: "CANADA TESTS FOREIGN-STUDENT CURBS", deck: "" },
        { style: "one-liner", head: "ECUADOR: US TALKS TO REVIEW OPERATIONS", deck: "" },
        { style: "one-liner", head: "CIA/ODNI DETAILS LEAK IN SECURITY LAPSE", deck: "" },
        { style: "one-liner", head: "THE QUAD IN PRECARIOUS STATE", deck: "" },
      ],
    },
  ],
];

// --- layout ----------------------------------------------------------------

function drawDeskHead(sheet: Sheet, x: number, y: number, title: string): number {
  sheet.fill(x, y, COLUMN_WIDTH, 26, PALETTE.ink);
  drawText(sheet, x + 8, y + 6, title, 2, PALETTE.paper, true);
  return y + 30;
}

// A feature story: a red square, a bold two-line headline and a deck line.
function drawFeature(sheet: Sheet, x: number, y: number, item: NewsItem): number {
  sheet.fill(x, y + 2, 8, 8, PALETTE.red);
  let next = drawParagraph(sheet, x + 14, y, item.head, 2, COLUMN_WIDTH - 14, PALETTE.ink, true);
  next = drawParagraph(sheet, x + 14, next + 1, item.deck, 1, COLUMN_WIDTH - 14, PALETTE.grey);
  return next + 4;
}

// A brief story: a smaller red square, a bold headline and a deck line.
function drawBrief(sheet: Sheet, x: number, y: number, item: NewsItem): number {
  sheet.fill(x, y + 2, 6, 6, PALETTE.red);
  let next = drawParagraph(sheet, x + 12, y, item.head, 1, COLUMN_WIDTH - 12, PALETTE.ink, true);
  next = drawParagraph(sheet, x + 12, next + 1, item.deck, 1, COLUMN_WIDTH - 12, PALETTE.grey);
  return next + 3;
}

// A one-line brief: a bullet dot and the headline only, no deck.
function drawOneLiner(sheet: Sheet, x: number, y: number, item: NewsItem): number {
  drawText(sheet, x, y, "• " + item.head, 1, PALETTE.ink, true);
  return y + 10;
}

function masthead(sheet: Sheet): void {
  drawGlobe(sheet, 72, 58, 40, PALETTE.blue);
  drawText(sheet, 132, 30, "THE WORLD TODAY", 7, PALETTE.ink, true);
  sheet.fill(872, 22, 124, 78, PALETTE.red);
  drawText(sheet, 906, 30, "26", 5, PALETTE.paper, true);
  drawText(sheet, 910, 68, "NOV 2026", 1, PALETTE.paper, true);
  sheet.rule(MARGIN, 116, PAGE_WIDTH - 2 * MARGIN, PALETTE.ink, 3);
  drawCentred(sheet, 128, "THURSDAY, 26 NOVEMBER 2026", 2, PALETTE.ink, true);
  drawCentred(
    sheet,
    150,
    "64 STORIES FROM EVERY REGION — ONE DAY, ONE PAGE — DATE CHECKED",
    1,
    PALETTE.grey,
  );
  sheet.rule(MARGIN, 168, PAGE_WIDTH - 2 * MARGIN, PALETTE.ink, 1);
}

function leadStory(sheet: Sheet): void {
  let y = 182;
  drawText(sheet, MARGIN, y, LEAD_TAG, 2, PALETTE.red, true);
  y += 24;
  for (const line of LEAD_LINES) {
    drawText(sheet, MARGIN, y, line, 4, PALETTE.ink, true);
    y += 34;
  }
  y = drawParagraph(sheet, MARGIN, y + 2, LEAD_DECK, 2, 672, PALETTE.ink);
  drawText(sheet, MARGIN, y + 4, LEAD_CREDIT, 1, PALETTE.grey);
  // Cargo ship and tariff facts, right of the lead text.
  drawFreighter(sheet, 706, 190);
  let fy = 182;
  for (const fact of TARIFF_FACTS) {
    drawText(sheet, 824, fy, fact, 1, PALETTE.ink, true);
    fy += 9;
  }
  sheet.rule(MARGIN, 344, PAGE_WIDTH - 2 * MARGIN, PALETTE.ink, 1);
}

function dayTimeline(sheet: Sheet): void {
  // The strip title sits at the right end so it never collides with the
  // first node's time label.
  drawText(sheet, 884, 352, "THE DAY IN UTC", 1, PALETTE.red, true);
  sheet.rule(MARGIN, 368, PAGE_WIDTH - 2 * MARGIN, PALETTE.ink, 1);
  DAY_BEATS.forEach((beat, i) => {
    const nodeX = 60 + i * 160;
    sheet.fill(nodeX - 3, 365, 7, 7, PALETTE.red);
    const whenW = textWidth(beat.when, 1);
    drawText(sheet, nodeX - Math.round(whenW / 2), 354, beat.when, 1, PALETTE.ink, true);
    let lineY = 376;
    for (const line of wrapLines(beat.what, 1, 156)) {
      drawText(sheet, nodeX - Math.round(textWidth(line, 1) / 2), lineY, line, 1, PALETTE.ink);
      lineY += 9;
    }
  });
}

function mapBand(sheet: Sheet): void {
  const map = loadMap(new URL("./map.png", import.meta.url).pathname);
  if (map.width !== PAGE_WIDTH - 2 * MARGIN || map.height !== 76) {
    throw new Error(
      "map.png is " + map.width + "x" + map.height + "; expected " + (PAGE_WIDTH - 2 * MARGIN) + "x76",
    );
  }
  blitMap(sheet, map, MARGIN, 394);
  for (const pin of MAP_PINS) {
    sheet.fill(pin.x - 3, pin.y - 3, 6, 6, PALETTE.red);
    drawText(sheet, pin.x + 5, pin.y - 3, pin.n, 1, PALETTE.ink, true);
  }
  drawText(
    sheet,
    MARGIN,
    474,
    "WHERE IT HAPPENED — 1 WASHINGTON  2 CAIRO  3 JEDDAH  4 KYIV  5 SAVASLEYKA  6 CANARIES  7 MUMBAI  8 JAKARTA  9 SAN JUAN  10 HONG KONG",
    1,
    PALETTE.grey,
  );
  sheet.rule(MARGIN, 484, PAGE_WIDTH - 2 * MARGIN, PALETTE.ink, 1);
}

function storyColumns(sheet: Sheet): void {
  const top = 492;
  let deepest = top;
  DESKS.forEach((desks, ci) => {
    let y = top;
    const x = COLUMN_LEFT[ci]!;
    for (const desk of desks) {
      y = drawDeskHead(sheet, x, y, desk.title);
      for (const item of desk.items) {
        if (item.style === "feature") y = drawFeature(sheet, x, y, item);
        else if (item.style === "one-liner") y = drawOneLiner(sheet, x, y, item);
        else y = drawBrief(sheet, x, y, item);
      }
      y += 2;
    }
    console.error("column " + ci + " ends at y=" + y);
    if (y > deepest) deepest = y;
  });
  if (deepest > 990) console.error("WARNING: columns run to y=" + deepest);
  else console.error("columns end at y=" + deepest);
}

function pageFooter(sheet: Sheet): void {
  sheet.rule(MARGIN, 992, PAGE_WIDTH - 2 * MARGIN, PALETTE.ink, 2);
  drawCentred(
    sheet,
    1002,
    "THE WORLD TODAY — THURSDAY 26 NOVEMBER 2026 — EVERY STORY REPORTED TODAY",
    1,
    PALETTE.grey,
  );
}

function buildPage(): Sheet {
  const sheet = new Sheet(PAGE_WIDTH, PAGE_HEIGHT, PALETTE.paper);
  masthead(sheet);
  leadStory(sheet);
  dayTimeline(sheet);
  mapBand(sheet);
  storyColumns(sheet);
  pageFooter(sheet);
  return sheet;
}

function main(): void {
  const sheet = buildPage();
  const dest = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  mkdirSync(dest, { recursive: true });
  const target = dest + "/entry.png";
  writeFileSync(target, encodeSheet(sheet));
  assertPng(target);
}

main();
