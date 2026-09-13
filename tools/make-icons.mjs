/**
 * 產生 PWA 圖示。無外部相依 —— 這台是 Intel Mac，裝 ImageMagick 要從原始碼編譯。
 * 只用 node 內建的 zlib 手寫 PNG。
 *
 *   node tools/make-icons.mjs
 *
 * 圖案是「三」：三條橫槓，正好對上三個語言，也正好是那個字。
 * 以 4 倍解析度畫再降採樣，圓角與橫槓邊緣才不會有鋸齒。
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const INK = [0x2F, 0x4B, 0x86];   // --accent
const PAPER = [0xF5, 0xF8, 0xFC]; // --on-accent
const SS = 4;                      // supersample 倍率

// ── PNG 編碼 ────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** rgba: Uint8Array，長度 w*h*4 */
function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  ihdr[10] = 0;  // deflate
  ihdr[11] = 0;  // adaptive filter
  ihdr[12] = 0;  // no interlace

  // 每條掃描線前面要加一個 filter byte，這裡一律用 0（None）
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4)
      .copy(raw, y * (w * 4 + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── 畫圖 ────────────────────────────────────────────

/**
 * @param size     輸出邊長
 * @param radius   圓角半徑佔邊長的比例（0 = 直角、滿版）
 * @param inset    內容留白佔邊長的比例（maskable 要留安全區）
 */
function drawIcon(size, radius, inset) {
  const S = size * SS;
  const hi = new Uint8Array(S * S * 4);

  const r = radius * S;
  const put = (x, y, [red, g, b]) => {
    const i = (y * S + x) * 4;
    hi[i] = red; hi[i + 1] = g; hi[i + 2] = b; hi[i + 3] = 255;
  };

  // 底色（圓角矩形）
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (!insideRounded(x, y, S, r)) continue;
      put(x, y, INK);
    }
  }

  // 「三」的三條橫槓。中間最短、最下最長 —— 照這個字實際的比例
  const pad = inset * S;
  const inner = S - pad * 2;
  const bar = inner * 0.115;                  // 槓高
  const gap = (inner - bar * 3) / 2 * 0.62;   // 槓距
  const widths = [0.74, 0.52, 0.92];

  const blockH = bar * 3 + gap * 2;
  let top = pad + (inner - blockH) / 2;

  for (const wRatio of widths) {
    const barW = inner * wRatio;
    const left = pad + (inner - barW) / 2;
    for (let y = Math.round(top); y < Math.round(top + bar); y++) {
      for (let x = Math.round(left); x < Math.round(left + barW); x++) {
        if (x < 0 || y < 0 || x >= S || y >= S) continue;
        put(x, y, PAPER);
      }
    }
    top += bar + gap;
  }

  return downsample(hi, S, size);
}

function insideRounded(x, y, S, r) {
  if (r <= 0) return true;
  const cx = Math.min(Math.max(x, r), S - r);
  const cy = Math.min(Math.max(y, r), S - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

/** 盒式降採樣。圓角與橫槓的邊緣靠這一步變平滑 */
function downsample(hi, S, size) {
  const out = new Uint8Array(size * size * 4);
  const n = SS * SS;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let dy = 0; dy < SS; dy++) {
        for (let dx = 0; dx < SS; dx++) {
          const i = ((y * SS + dy) * S + (x * SS + dx)) * 4;
          const alpha = hi[i + 3];
          // 透明的像素沒有顏色可言，乘上 alpha 再平均，邊緣才不會滲出黑邊
          r += hi[i] * alpha; g += hi[i + 1] * alpha; b += hi[i + 2] * alpha;
          a += alpha;
        }
      }
      const j = (y * size + x) * 4;
      if (a === 0) { out[j] = out[j + 1] = out[j + 2] = out[j + 3] = 0; continue; }
      out[j] = Math.round(r / a);
      out[j + 1] = Math.round(g / a);
      out[j + 2] = Math.round(b / a);
      out[j + 3] = Math.round(a / n);
    }
  }
  return out;
}

// ── 產出 ────────────────────────────────────────────

mkdirSync('public/icons', { recursive: true });

const FILES = [
  // 一般圖示：圓角、內容留白小
  ['icon-192.png', 192, 0.18, 0.20],
  ['icon-512.png', 512, 0.18, 0.20],
  // maskable：系統會自己裁形狀，所以滿版，內容縮進安全區（四邊各留 10%）
  ['icon-maskable-512.png', 512, 0, 0.28],
  // iOS 的加入主畫面：iOS 自己套圓角遮罩，所以給滿版直角
  ['apple-touch-icon.png', 180, 0, 0.20],
];

for (const [name, size, radius, inset] of FILES) {
  const png = encodePng(size, size, drawIcon(size, radius, inset));
  writeFileSync(`public/icons/${name}`, png);
  console.log(`  ${name.padEnd(24)} ${size}×${size}  ${(png.length / 1024).toFixed(1)} KB`);
}
