/**
 * Title-screen backdrop: a procedural pixel-art night skyline (server farms,
 * blinking windows, rack LEDs), raining coins and data blocks, a rooftop mining
 * rig with a technician, and the big "HASH HARVEST TYCOON" block-font logo.
 *
 * Everything static is baked into offscreen canvases on `resize`; `render`
 * only blits cached layers and draws a few hundred live pixels (LEDs, coins,
 * fans), so a frame costs a fraction of a millisecond. No allocations per frame.
 */
import { COOLER_BY_ID, GPU_BY_ID, PSU_BY_ID, RACK_BY_ID } from '../config/hardwareCatalog';
import type { GpuModel } from '../types/hardware';
import { drawPixelText, fanSlotRect, gpuSlotRect, px, PSU_RECT, RACK_H, RACK_W, shade, sprites, type GpuDrawState } from './SpriteManager';

type Ctx = CanvasRenderingContext2D;

interface Surface {
  canvas: HTMLCanvasElement;
  ctx: Ctx;
}

function surface(w: number, h: number): Surface {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  const ctx = canvas.getContext('2d') as Ctx;
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}

/** Deterministic PRNG (mulberry32) so the skyline is the same on every visit. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(r: () => number, list: readonly T[]): T => list[Math.floor(r() * list.length)];
const irange = (r: () => number, lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1));
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
/** Cheap deterministic hash of an integer → [0,1). */
const hashInt = (n: number): number => {
  const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
};

/** Pixel disc filled row by row (no anti-aliasing). */
function disc(ctx: Ctx, cx: number, cy: number, r: number, color: string): void {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y += 1) {
    const dy = y + 0.5 - cy;
    const half = Math.sqrt(Math.max(0, r * r - dy * dy));
    if (half <= 0) continue;
    const x0 = Math.round(cx - half);
    const x1 = Math.round(cx + half);
    if (x1 > x0) px(ctx, x0, y, x1 - x0, 1, color);
  }
}

/**
 * Integer device-pixel scale for a backdrop of `devW × devH` device pixels:
 * aims for roughly a 440×260 logical buffer so pixels stay chunky everywhere.
 */
export function titleScale(devW: number, devH: number): number {
  return Math.max(1, Math.round(Math.sqrt((devW * devH) / (440 * 260))));
}

// ───────────────────────── Block font (6×7, 2-px stems) ─────────────────────────

const BLOCK_GLYPHS: Record<string, readonly string[]> = {
  A: ['011110', '110011', '110011', '111111', '110011', '110011', '110011'],
  C: ['011111', '110000', '110000', '110000', '110000', '110000', '011111'],
  E: ['111111', '110000', '110000', '111110', '110000', '110000', '111111'],
  H: ['110011', '110011', '110011', '111111', '110011', '110011', '110011'],
  N: ['110011', '111011', '111111', '110111', '110011', '110011', '110011'],
  O: ['011110', '110011', '110011', '110011', '110011', '110011', '011110'],
  R: ['111110', '110011', '110011', '111110', '110110', '110011', '110011'],
  S: ['011111', '110000', '110000', '011110', '000011', '000011', '111110'],
  T: ['111111', '001100', '001100', '001100', '001100', '001100', '001100'],
  V: ['110011', '110011', '110011', '110011', '110011', '011110', '001100'],
  Y: ['110011', '110011', '110011', '011110', '001100', '001100', '001100'],
};
const GLYPH_W = 6;
const GLYPH_H = 7;
const SPACE_W = 3;

/** Width in font cells of a block-font word (letter spacing of one cell). */
function blockUnits(text: string): number {
  let u = 0;
  for (const ch of text) u += (ch === ' ' ? SPACE_W : GLYPH_W) + 1;
  return Math.max(0, u - 1);
}

interface WordStyle {
  hi: string;
  top: string;
  bottom: string;
  low: string;
  side: string;
  sideDark: string;
}

const OUTLINE = '#07060f';
const GOLD: WordStyle = { hi: '#fffbeb', top: '#fde047', bottom: '#f59e0b', low: '#c2410c', side: '#9a3412', sideDark: '#431407' };
const CYAN: WordStyle = { hi: '#ecfeff', top: '#a5f3fc', bottom: '#22d3ee', low: '#0e7490', side: '#155e75', sideDark: '#082f49' };

interface Cell {
  x: number;
  y: number;
  row: number;
  above: boolean;
  below: boolean;
}

/**
 * Draws a chunky two-tone block word with a 1-px outline and a one-cell
 * extrusion. Faces are also painted white into `mask` (for the shine sweep).
 * Returns the glyph origins (top-left of each letter) for sparkles.
 */
function drawBlockWord(ctx: Ctx, mask: Ctx, text: string, x: number, y: number, c: number, st: WordStyle): Array<{ x: number; y: number }> {
  const cells: Cell[] = [];
  const origins: Array<{ x: number; y: number }> = [];
  let gx = x;
  for (const ch of text) {
    const g = BLOCK_GLYPHS[ch];
    if (!g) {
      gx += (SPACE_W + 1) * c;
      continue;
    }
    origins.push({ x: gx, y });
    for (let row = 0; row < GLYPH_H; row += 1) {
      for (let col = 0; col < GLYPH_W; col += 1) {
        if (g[row][col] !== '1') continue;
        cells.push({
          x: gx + col * c,
          y: y + row * c,
          row,
          above: row > 0 && g[row - 1][col] === '1',
          below: row < GLYPH_H - 1 && g[row + 1][col] === '1',
        });
      }
    }
    gx += (GLYPH_W + 1) * c;
  }
  const depth = c;
  for (const k of cells) px(ctx, k.x - 1, k.y - 1, c + 2, c + depth + 2, OUTLINE);
  for (const k of cells) {
    px(ctx, k.x, k.y, c, c + depth, st.side);
    if (!k.below) px(ctx, k.x, k.y + c + depth - 1, c, 1, st.sideDark);
  }
  const split = Math.round(GLYPH_H * c * 0.5);
  for (const k of cells) {
    for (let r = 0; r < c; r += 1) {
      const py = k.row * c + r;
      let color = py < split ? st.top : st.bottom;
      if (r === 0 && !k.above) color = py < split ? st.hi : st.top;
      if (r === c - 1 && !k.below && py >= split) color = st.low;
      px(ctx, k.x, k.y + r, c, 1, color);
    }
    px(mask, k.x, k.y, c, c, '#ffffff');
  }
  // Gloss dot on each letter's first lit cell
  for (const o of origins) {
    const first = cells.find((k) => k.y === o.y && k.x >= o.x);
    if (first) px(ctx, first.x + 1, first.y + 1, 1, 1, '#ffffff');
  }
  return origins;
}

// ───────────────────────── Scene data ─────────────────────────

interface Blinker {
  x: number;
  y: number;
  w: number;
  h: number;
  on: string;
  off: string;
  period: number;
  phase: number;
  duty: number;
  cross: boolean;
  /** State already painted into the tile (skip drawing while equal); null = always draw. */
  baked: boolean | null;
  /** Optional darker bottom row for lit windows. */
  lo: string | null;
}

interface FanSpot {
  x: number;
  y: number;
  d: number;
}

interface SignSpot {
  x: number;
  y: number;
  on: HTMLCanvasElement;
  seed: number;
}

interface Layer {
  tile: Surface;
  tw: number;
  speed: number;
  blinkers: Blinker[];
  fans: FanSpot[];
  signs: SignSpot[];
}

interface Faller {
  x: number;
  y: number;
  vy: number;
  sway: number;
  phase: number;
  kind: 0 | 1;
}

interface Dust {
  x: number;
  y: number;
  vy: number;
  color: string;
}

interface Puff {
  x: number;
  y: number;
  life: number;
  max: number;
}

interface Cloud {
  sprite: HTMLCanvasElement;
  y: number;
  speed: number;
  x0: number;
}

interface RackRig {
  x: number;
  y: number;
  gpus: GpuModel[];
}

const RUNNING: GpuDrawState = { running: true, load: 0.85, temp: 61, shutdown: false, throttled: false };
const SKY = ['#05040d', '#08071a', '#0c0a24', '#110d30', '#17113b', '#1e1446', '#28184f', '#331b57'] as const;

/** Fixed time used for the reduced-motion still frame (shine off, rig mid-walk). */
export const TITLE_STILL_TIME = 2.6;

export class TitleScene {
  readonly buffer: HTMLCanvasElement;
  private ctx: Ctx;
  private W = 0;
  private H = 0;
  private groundY = 0;
  private floorY = 0;
  private sky: Surface | null = null;
  private fg: Surface | null = null;
  private overlay: Surface | null = null;
  private logo: Surface | null = null;
  /** Horizontal runs of letter-face pixels per logo row: [x0, x1) pairs, indexed by `shineRow`. */
  private shineRuns = new Int16Array(0);
  private shineRow = new Int32Array(1);
  private logoShadow: Surface | null = null;
  private line1Bottom = 0;
  private ribbonRight = 0;
  private logoX = 0;
  private logoY = 0;
  private logoSparkles: Array<{ x: number; y: number }> = [];
  private ribbonCoins: Array<{ x: number; y: number }> = [];
  private ribbonCoinScale = 1;
  private layers: Layer[] = [];
  private twinkles: Array<{ x: number; y: number; big: boolean; phase: number }> = [];
  private clouds: Cloud[] = [];
  private fallers: Faller[] = [];
  private dust: Dust[] = [];
  private puffs: Puff[] = [];
  private racks: RackRig[] = [];
  private acX = 0;
  private acFan = { x: 0, y: 0, d: 13 };
  private mast = { x: 0, y: 0 };
  private pile = { x: 0, y: 0 };
  private walk = { x0: 0, x1: 0 };
  private particles: boolean;

  constructor(particles = true) {
    this.particles = particles;
    const s = surface(1, 1);
    this.buffer = s.canvas;
    this.ctx = s.ctx;
  }

  setParticles(on: boolean): void {
    if (on === this.particles) return;
    this.particles = on;
    this.seedFallers();
  }

  /** Rebuilds every cached layer for a `w × h` logical buffer. */
  resize(w: number, h: number): void {
    const W = Math.max(64, Math.round(w));
    const H = Math.max(64, Math.round(h));
    if (W === this.W && H === this.H) return;
    this.W = W;
    this.H = H;
    this.buffer.width = W;
    this.buffer.height = H;
    this.ctx.imageSmoothingEnabled = false;
    const fgH = clamp(Math.round(H * 0.14), 28, 64);
    this.groundY = H - fgH;
    this.floorY = this.groundY + 10 + Math.round((H - this.groundY - 10) * 0.45);
    this.buildLogo();
    this.buildSky();
    this.layers = [this.buildFar(), this.buildMid(), this.buildNear()];
    this.buildForeground();
    this.buildOverlay();
    this.seedFallers();
  }

  // ───────────── Logo ─────────────

  private buildLogo(): void {
    const { W, H } = this;
    const maxW = W * 0.8;
    let lines: string[] = ['HASH HARVEST'];
    let c = 4;
    while (c > 2 && blockUnits('HASH HARVEST') * c > maxW) c -= 1;
    if (blockUnits('HASH HARVEST') * c > maxW || (c < 3 && W < H)) {
      lines = ['HASH', 'HARVEST'];
      c = 4;
      while (c > 2 && blockUnits('HARVEST') * c > W * 0.84) c -= 1;
    }
    if (H < 180) c = Math.min(c, 3);
    const c2 = Math.max(2, c - 1);
    const lineH = GLYPH_H * c + c + 2;
    const gap = Math.max(2, c - 1);
    const tycW = blockUnits('TYCOON') * c2;
    const coinS = c2 >= 3 ? 2 : 1;
    const coinW = 7 * coinS;
    const ribPad = Math.max(3, c2);
    const ribInnerW = tycW + 2 * (coinW + 2 * ribPad);
    const ribH = GLYPH_H * c2 + c2 + 2 * ribPad + 2;
    const tail = Math.max(8, ribH >> 1);
    const wordsW = Math.max(...lines.map((l) => blockUnits(l) * c));
    const LW = Math.max(wordsW + 4, ribInnerW + 2 * tail + 4);
    const LH = lines.length * lineH + (lines.length - 1) * gap + gap + ribH + 4;
    const logo = surface(LW, LH);
    const mask = surface(LW, LH);
    this.logo = logo;
    this.logoSparkles = [];
    this.line1Bottom = 0;
    let y = 1;
    for (const line of lines) {
      const lw = blockUnits(line) * c;
      const origins = drawBlockWord(logo.ctx, mask.ctx, line, Math.round((LW - lw) / 2), y, c, GOLD);
      origins.forEach((o, i) => {
        if (i % 3 === 0) this.logoSparkles.push({ x: o.x - 1, y: o.y - 1 });
      });
      y += lineH + gap;
      if (!this.line1Bottom) this.line1Bottom = y - gap;
    }
    // Ribbon banner behind "TYCOON"
    const rx = Math.round((LW - ribInnerW) / 2);
    const ry = y;
    const rc = logo.ctx;
    const tailY = ry + 4;
    const tailH = ribH - 2;
    [rx - tail, rx + ribInnerW].forEach((tx0, side) => {
      px(rc, tx0 - (side ? 0 : 1), tailY - 1, tail + 1, tailH + 2, OUTLINE);
      px(rc, tx0, tailY, tail, tailH, '#7c2d12');
      px(rc, tx0, tailY, tail, 1, '#c2410c');
      px(rc, tx0, tailY + tailH - 1, tail, 1, '#431407');
      // Swallow-tail notch
      const mid = tailY + (tailH >> 1);
      const notch = Math.max(3, tail >> 1);
      for (let k = -notch; k <= notch; k += 1) {
        const d = notch - Math.abs(k) + 1;
        const nx = side ? tx0 + tail - d : tx0 - 1;
        rc.clearRect(nx, mid + k, d + 1, 1);
      }
      // Fold shadow where the tail tucks behind the banner
      px(rc, side ? tx0 : tx0 + tail - 3, tailY, 3, tailH, '#431407');
    });
    px(rc, rx - 1, ry - 1, ribInnerW + 2, ribH + 2, OUTLINE);
    px(rc, rx, ry, ribInnerW, ribH, '#facc15');
    px(rc, rx + 1, ry + 1, ribInnerW - 2, ribH - 2, '#a16207');
    px(rc, rx + 2, ry + 2, ribInnerW - 4, ribH - 4, '#1e1b4b');
    px(rc, rx + 2, ry + 2, ribInnerW - 4, 1, '#312e81');
    px(rc, rx + 2, ry + ribH - 3, ribInnerW - 4, 1, '#0f0d2e');
    for (let x = rx + 4; x < rx + ribInnerW - 4; x += 6) {
      px(rc, x, ry, 2, 1, '#fef9c3');
      px(rc, x + 3, ry + ribH - 1, 2, 1, '#713f12');
    }
    const ty = ry + ribPad + 1;
    const tx = Math.round((LW - tycW) / 2);
    drawBlockWord(rc, mask.ctx, 'TYCOON', tx, ty, c2, CYAN);
    const coinY = ry + Math.round((ribH - coinW) / 2);
    this.ribbonCoinScale = coinS;
    this.ribbonCoins = [
      { x: rx + ribPad + 1, y: coinY },
      { x: rx + ribInnerW - ribPad - 1 - coinW, y: coinY },
    ];
    this.logoX = Math.round((W - LW) / 2);
    this.logoY = Math.max(4, Math.round(H * (W >= H ? 0.05 : 0.06)));
    this.ribbonRight = this.logoX + rx + ribInnerW + tail;
    this.buildShineRuns(mask, LW, LH);
    // Solid dark silhouette for the drop shadow
    const shadow = surface(LW, LH);
    shadow.ctx.drawImage(logo.canvas, 0, 0);
    shadow.ctx.globalCompositeOperation = 'source-in';
    px(shadow.ctx, 0, 0, LW, LH, '#020108');
    shadow.ctx.globalCompositeOperation = 'source-over';
    this.logoShadow = shadow;
  }

  /** Bakes the face mask into per-row runs so the shine needs no per-frame compositing. */
  private buildShineRuns(mask: Surface, LW: number, LH: number): void {
    const data = mask.ctx.getImageData(0, 0, LW, LH).data;
    const runs: number[] = [];
    const rows = new Int32Array(LH + 1);
    for (let y = 0; y < LH; y += 1) {
      rows[y] = runs.length;
      let start = -1;
      for (let x = 0; x <= LW; x += 1) {
        const on = x < LW && data[(y * LW + x) * 4 + 3] > 0;
        if (on && start < 0) start = x;
        else if (!on && start >= 0) {
          runs.push(start, x);
          start = -1;
        }
      }
    }
    rows[LH] = runs.length;
    this.shineRuns = Int16Array.from(runs);
    this.shineRow = rows;
  }

  private logoBottom(): number {
    return this.logoY + (this.logo?.canvas.height ?? 0);
  }

  // ───────────── Sky, moon, stars, clouds ─────────────

  private buildSky(): void {
    const { W, H, groundY } = this;
    const sky = surface(W, H);
    this.sky = sky;
    const c = sky.ctx;
    const r = rng(7);
    const n = SKY.length;
    const bandH = groundY / n;
    for (let i = 0; i < n; i += 1) {
      const y0 = Math.round(i * bandH);
      const y1 = i === n - 1 ? H : Math.round((i + 1) * bandH);
      px(c, 0, y0, W, y1 - y0, SKY[i]);
      if (i < n - 1) {
        // Checker dither into the next band
        for (let y = y1 - 2; y < y1; y += 1) for (let x = (y & 1); x < W; x += 2) px(c, x, y, 1, 1, SKY[i + 1]);
        for (let x = (y1 & 1); x < W; x += 4) px(c, x, y1 - 3, 1, 1, SKY[i + 1]);
      }
    }
    // Stars
    const skyTop = Math.round(groundY * 0.82);
    const count = Math.floor((W * skyTop) / 260);
    for (let i = 0; i < count; i += 1) {
      const x = Math.floor(r() * W);
      const y = Math.floor(r() * skyTop);
      const k = r();
      px(c, x, y, 1, 1, k < 0.6 ? '#3b3970' : k < 0.9 ? '#818cf8' : '#e0e7ff');
    }
    this.twinkles = [];
    const tw = clamp(Math.floor(W / 22), 10, 30);
    for (let i = 0; i < tw; i += 1) {
      this.twinkles.push({ x: Math.floor(r() * W), y: Math.floor(r() * skyTop * 0.9), big: i % 4 === 0, phase: r() * 10 });
    }
    // The coin moon
    const R = clamp(Math.round(Math.min(W, H) * 0.075), 10, 22);
    const landscape = W >= H;
    // Landscape: tucked right of the ribbon, under the first word. Portrait: below the logo.
    const mx = Math.round(landscape ? clamp(Math.max(this.ribbonRight + R + 10, W * 0.85), R + 4, W - R - 6) : W * 0.78);
    const my = Math.round(landscape ? this.logoY + this.line1Bottom + R + 6 : this.logoBottom() + R + 14);
    for (let y = my - R - 12; y <= my + R + 12; y += 1) {
      for (let x = mx - R - 12; x <= mx + R + 12; x += 1) {
        const d = Math.hypot(x + 0.5 - mx, y + 0.5 - my);
        if (d <= R) continue;
        if (d <= R + 5 && (x + y) % 2 === 0) px(c, x, y, 1, 1, '#3a2f6e');
        else if (d <= R + 11 && x % 2 === 0 && y % 2 === 0) px(c, x, y, 1, 1, '#2a2259');
      }
    }
    for (let y = my - R; y <= my + R; y += 1) {
      for (let x = mx - R; x <= mx + R; x += 1) {
        const dx = x + 0.5 - mx;
        const dy = y + 0.5 - my;
        const d = Math.hypot(dx, dy);
        if (d > R) continue;
        let col = '#facc15';
        if (d > R - 1.3) col = '#a16207';
        else if (d > R - 2.3) col = dx + dy < 0 ? '#fde68a' : '#ca8a04';
        else if (d > R - 4 && d < R - 3) col = '#eab308';
        else if (dx + dy > R * 0.9) col = '#eab308';
        px(c, x, y, 1, 1, col);
      }
    }
    // Embossed "#" (hash) on the coin face
    const g = Math.max(7, Math.round(R * 0.95)) | 1;
    const th = g >= 13 ? 2 : 1;
    const q = Math.round(g / 4);
    const hx0 = mx - (g >> 1);
    const hy0 = my - (g >> 1);
    const hash = (dx: number, dy: number, col: string) => {
      px(c, mx - q + dx, hy0 + dy, th, g, col);
      px(c, mx + q - th + 1 + dx, hy0 + dy, th, g, col);
      px(c, hx0 + dx, my - q + dy, g, th, col);
      px(c, hx0 + dx, my + q - th + 1 + dy, g, th, col);
    };
    hash(1, 1, '#a16207');
    hash(0, 0, '#fef08a');
    // Clouds (cached sprites, drifting live)
    this.clouds = [];
    const nClouds = W >= H ? 4 : 3;
    for (let i = 0; i < nClouds; i += 1) {
      const cw = irange(r, 34, 70);
      const ch = irange(r, 9, 14);
      const s = surface(cw, ch + 2);
      // Puffs sitting on a shared baseline: big one in the middle, smaller towards the ends
      const bumps = 3 + Math.floor(r() * 2);
      const tmp: boolean[] = new Array(cw * (ch + 2)).fill(false);
      const base = ch;
      for (let b = 0; b < bumps; b += 1) {
        const f = (b + 0.5) / bumps;
        const bx = 4 + f * (cw - 8) + (r() - 0.5) * 4;
        const br = Math.max(3, (ch - 1) * (0.45 + 0.55 * Math.sin(f * Math.PI)) * 0.75 + r() * 1.5);
        const by = base - br;
        for (let y = 0; y < ch + 2; y += 1) for (let x = 0; x < cw; x += 1) {
          if (y <= base && Math.hypot(x + 0.5 - bx, y + 0.5 - by) <= br) tmp[y * cw + x] = true;
        }
      }
      for (let y = 0; y < ch + 2; y += 1) for (let x = 0; x < cw; x += 1) {
        if (!tmp[y * cw + x]) continue;
        const top = y === 0 || !tmp[(y - 1) * cw + x];
        const top2 = y > 1 && !tmp[(y - 2) * cw + x];
        const bottom = y >= base - 1;
        if (bottom && (x + y) % 2 === 1) continue;
        px(s.ctx, x, y, 1, 1, top ? '#5b4f9e' : top2 ? '#3a3175' : bottom ? '#1f1948' : '#2a2360');
      }
      this.clouds.push({ sprite: s.canvas, y: Math.round(groundY * (0.12 + r() * 0.42)), speed: 1.5 + r() * 3, x0: r() * (W + cw) });
    }
  }

  // ───────────── Parallax skyline layers ─────────────

  private buildFar(): Layer {
    const { groundY } = this;
    const tw = 288;
    const tile = surface(tw, groundY + 1);
    const c = tile.ctx;
    const r = rng(101);
    const body = '#100e28';
    let x = 0;
    let towerDone = false;
    while (x < tw) {
      if (!towerDone && x > tw * 0.45) {
        // Cooling tower of a big mining plant, with a frozen steam plume
        towerDone = true;
        const tw2 = 28;
        const th = Math.round(groundY * 0.28);
        for (let y = 0; y < th; y += 1) {
          const f = (y - th * 0.62) / th;
          const half = Math.round(8 + 50 * f * f);
          px(c, x + 14 - half, groundY - th + y, half * 2, 1, y < 2 ? '#1c1940' : body);
        }
        const top = groundY - th;
        for (let k = 0; k < 6; k += 1) {
          const pr = 5 + k * 1.6;
          const pcx = x + 14 + k * 4 + Math.round(Math.sin(k) * 2);
          const pcy = top - 4 - k * 6;
          for (let yy = Math.floor(pcy - pr); yy <= pcy + pr; yy += 1) for (let xx = Math.floor(pcx - pr); xx <= pcx + pr; xx += 1) {
            if (Math.hypot(xx - pcx, yy - pcy) > pr) continue;
            if (k > 3 && (xx + yy) % 2 === 0) continue;
            px(c, xx, yy, 1, 1, k < 2 ? '#2a2456' : '#211c4a');
          }
        }
        x += tw2 + 6;
        continue;
      }
      const bw = Math.min(irange(r, 12, 30), tw - x);
      if (bw < 6) break;
      const bh = Math.round(groundY * (0.2 + r() * 0.3));
      const top = groundY - bh;
      px(c, x, top, bw, bh + 1, body);
      if (r() < 0.35) {
        const sw = Math.max(4, bw >> 1);
        px(c, x + ((bw - sw) >> 1), top - 4, sw, 4, body);
      }
      if (r() < 0.3) px(c, x + (bw >> 1), top - irange(r, 6, 12), 1, 12, body);
      for (let wy = top + 3; wy < groundY - 2; wy += 3) for (let wx = x + 2; wx < x + bw - 2; wx += 3) {
        const k = r();
        if (k < 0.07) px(c, wx, wy, 1, 1, k < 0.02 ? '#6d5ba8' : '#2c2858');
      }
      x += bw + irange(r, 0, 3);
    }
    return { tile, tw, speed: 2, blinkers: [], fans: [], signs: [] };
  }

  private buildMid(): Layer {
    const { groundY } = this;
    const tw = 400;
    const tile = surface(tw, groundY + 1);
    const c = tile.ctx;
    const r = rng(202);
    const blinkers: Blinker[] = [];
    const signs: SignSpot[] = [];
    const bodies = ['#191737', '#1b1a3e', '#16142f'] as const;
    let x = 2;
    let idx = 0;
    while (x < tw - 8) {
      const special = idx === 3 ? 'tower' : idx === 7 ? 'billboard' : 'plain';
      let bw = special === 'tower' ? 26 : special === 'billboard' ? 42 : irange(r, 16, 36);
      bw = Math.min(bw, tw - 2 - x);
      if (bw < 8) break;
      const bh = special === 'tower' ? Math.round(groundY * 0.46) : Math.round(groundY * (0.13 + r() * 0.24));
      const top = groundY - bh;
      const b = pick(r, bodies);
      px(c, x, top, bw, bh + 1, b);
      px(c, x, top, 1, bh + 1, shade(b, 0.18));
      px(c, x + bw - 1, top, 1, bh + 1, shade(b, -0.35));
      px(c, x, top, bw, 1, shade(b, 0.25));
      // Roof furniture
      if (special === 'plain') {
        const roof = r();
        if (roof < 0.3) {
          const mh = irange(r, 7, 14);
          px(c, x + (bw >> 1), top - mh, 1, mh, '#2a2850');
          blinkers.push({ x: x + (bw >> 1), y: top - mh - 1, w: 1, h: 1, on: '#ef4444', off: '#3b0d16', period: 1.6 + r(), phase: r() * 3, duty: 0.3, cross: true, baked: null, lo: null });
        } else if (roof < 0.5) {
          const sw = Math.max(6, bw - 8);
          px(c, x + ((bw - sw) >> 1), top - 5, sw, 5, b);
          px(c, x + ((bw - sw) >> 1), top - 5, sw, 1, shade(b, 0.25));
        } else if (roof < 0.65) {
          // Water tank on legs
          const tx = x + 3;
          px(c, tx, top - 3, 1, 3, '#2a2850');
          px(c, tx + 6, top - 3, 1, 3, '#2a2850');
          px(c, tx - 1, top - 9, 9, 6, '#24224a');
          px(c, tx - 1, top - 9, 9, 1, '#34316a');
        }
      }
      // Windows
      const litP = 0.2 + r() * 0.3;
      const warm = r() < 0.7;
      const x0 = x + 3;
      const x1 = x + bw - 3;
      const y0 = special === 'tower' ? top + 22 : top + 4;
      for (let wy = y0; wy < groundY - 3; wy += 4) {
        for (let wx = x0; wx + 2 <= x1; wx += 4) {
          if (special === 'billboard' && wy < top + 4) continue;
          const lit = r() < litP;
          const on = warm ? (r() < 0.8 ? '#fbbf24' : '#fde68a') : r() < 0.7 ? '#67e8f9' : '#a5f3fc';
          const off = '#0d0b1f';
          px(c, wx, wy, 2, 2, lit ? on : off);
          if (lit) px(c, wx, wy + 1, 2, 1, warm ? '#d97706' : '#0891b2');
          if (r() < 0.06) blinkers.push({ x: wx, y: wy, w: 2, h: 2, on, off, period: 3 + r() * 7, phase: r() * 10, duty: 0.4 + r() * 0.5, cross: false, baked: lit, lo: warm ? '#d97706' : '#0891b2' });
        }
      }
      if (special === 'tower') {
        // The Hash Tower: spire, beacon, a coin emblem and a vertical neon sign
        const cx = x + (bw >> 1);
        px(c, cx - 4, top - 6, 8, 6, b);
        px(c, cx - 4, top - 6, 8, 1, shade(b, 0.25));
        px(c, cx, top - 22, 1, 16, '#3a3770');
        blinkers.push({ x: cx, y: top - 23, w: 1, h: 1, on: '#f87171', off: '#3b0d16', period: 1.2, phase: 0, duty: 0.35, cross: true, baked: null, lo: null });
        disc(c, cx + 0.5, top + 10, 7, '#07060f');
        disc(c, cx + 0.5, top + 10, 6, '#a16207');
        disc(c, cx + 0.5, top + 10, 5, '#eab308');
        drawPixelText(c, '#', cx - 1, top + 8, '#a16207');
        px(c, cx - 3, top + 6, 2, 1, '#fef08a');
        const sign = surface(7, 27);
        px(sign.ctx, 0, 0, 7, 27, '#2a0a24');
        'HASH'.split('').forEach((ch, i) => drawPixelText(sign.ctx, ch, 2, 2 + i * 6, '#f9a8d4'));
        px(sign.ctx, 0, 0, 7, 1, '#f472b6');
        px(sign.ctx, 0, 26, 7, 1, '#f472b6');
        const sx = x + bw + 1;
        const sy = top + 24;
        if (sx + 7 < tw) {
          px(c, sx, sy, 7, 27, '#2a0a24');
          'HASH'.split('').forEach((ch, i) => drawPixelText(c, ch, sx + 2, sy + 2 + i * 6, '#5b1a45'));
          px(c, sx - 1, sy + 4, 1, 1, '#2a2850');
          px(c, sx - 1, sy + 22, 1, 1, '#2a2850');
          signs.push({ x: sx, y: sy, on: sign.canvas, seed: 3 });
        }
        x += 8;
      }
      if (special === 'billboard') {
        const bb = surface(41, 11);
        px(bb.ctx, 0, 0, 41, 11, '#061a24');
        px(bb.ctx, 0, 0, 41, 1, '#22d3ee');
        px(bb.ctx, 0, 10, 41, 1, '#22d3ee');
        drawPixelText(bb.ctx, 'MINE 24/7', 21, 3, '#a5f3fc', { align: 'center' });
        const bx = x;
        const by = top - 15;
        px(c, bx + 6, top - 4, 1, 4, '#2a2850');
        px(c, bx + 34, top - 4, 1, 4, '#2a2850');
        px(c, bx, by, 41, 11, '#061a24');
        drawPixelText(c, 'MINE 24/7', bx + 21, by + 3, '#164e63', { align: 'center' });
        signs.push({ x: bx, y: by, on: bb.canvas, seed: 11 });
      }
      x += bw + irange(r, 1, 4);
      idx += 1;
    }
    return { tile, tw, speed: 5, blinkers, fans: [], signs };
  }

  private buildNear(): Layer {
    const { groundY } = this;
    const tw = 352;
    const tile = surface(tw, groundY + 1);
    const c = tile.ctx;
    const r = rng(303);
    const blinkers: Blinker[] = [];
    const fans: FanSpot[] = [];
    const ledOn = ['#22c55e', '#4ade80', '#22d3ee', '#22c55e', '#facc15'] as const;
    // Ground haze strip the warehouses stand on
    px(c, 0, groundY - 2, tw, 3, '#0a0817');
    let x = 0;
    let idx = 0;
    while (x < tw - 20) {
      const bw = Math.min(irange(r, 52, 92), tw - x);
      if (bw < 30) break;
      const bh = Math.max(16, Math.round(groundY * (0.08 + r() * 0.05)));
      const top = groundY - bh;
      px(c, x, top, bw, bh, '#0b1020');
      for (let y = top + 3; y < groundY; y += 2) px(c, x, y, bw, 1, '#0e1428');
      px(c, x, top, bw, 2, '#1e2742');
      px(c, x, top, bw, 1, '#33416a');
      px(c, x, top, 1, bh, '#1a223a');
      // Rooftop HVAC + vent stacks
      for (let k = 0; k < 2; k += 1) {
        const hx = x + 6 + Math.floor(r() * (bw - 20));
        px(c, hx, top - 4, 8, 4, '#131a2e');
        px(c, hx, top - 4, 8, 1, '#2a3555');
        px(c, hx + 2, top - 3, 4, 1, '#0a0e1a');
      }
      if (idx % 2 === 0) {
        const vx = x + bw - 8;
        px(c, vx, top - 9, 3, 9, '#151c31');
        px(c, vx, top - 9, 3, 1, '#2a3555');
        blinkers.push({ x: vx + 1, y: top - 10, w: 1, h: 1, on: '#ef4444', off: '#2a0b10', period: 2 + r(), phase: r() * 2, duty: 0.25, cross: false, baked: null, lo: null });
      }
      if (idx === 1) {
        const sw = 39;
        const sx = x + Math.max(2, (bw - sw) >> 1);
        px(c, sx + 4, top - 3, 1, 3, '#1e2742');
        px(c, sx + sw - 5, top - 3, 1, 3, '#1e2742');
        px(c, sx, top - 12, sw, 9, '#04140a');
        px(c, sx, top - 12, sw, 1, '#166534');
        drawPixelText(c, 'HASHFARM', sx + (sw >> 1), top - 10, '#4ade80', { align: 'center' });
      }
      // Server window strip with rack columns and LEDs
      const fanCount = bw > 70 ? 2 : 1;
      const fanD = 7;
      const stripX0 = x + 3;
      const stripX1 = x + bw - 3 - fanCount * (fanD + 2);
      const sy0 = top + 4;
      const sy1 = groundY - 3;
      px(c, stripX0, sy0, stripX1 - stripX0, sy1 - sy0, '#03050b');
      px(c, stripX0, sy0, stripX1 - stripX0, 1, '#1b2440');
      for (let cx = stripX0 + 1; cx + 2 < stripX1; cx += 4) {
        px(c, cx, sy0 + 1, 3, sy1 - sy0 - 1, '#0f1626');
        for (let ly = sy0 + 2; ly < sy1 - 1; ly += 2) {
          const on = pick(r, ledOn);
          const lit = r() < 0.75;
          px(c, cx + 1, ly, 1, 1, lit ? on : '#0b1f14');
          if (r() < 0.45) blinkers.push({ x: cx + 1, y: ly, w: 1, h: 1, on, off: '#0b1f14', period: 0.25 + r() * 1.4, phase: r() * 2, duty: 0.35 + r() * 0.5, cross: false, baked: lit, lo: null });
        }
      }
      for (let k = 0; k < fanCount; k += 1) {
        const fx = stripX1 + 2 + k * (fanD + 2);
        const fy = top + Math.max(3, ((bh - fanD) >> 1));
        px(c, fx - 1, fy - 1, fanD + 2, fanD + 2, '#05070d');
        fans.push({ x: fx, y: fy, d: fanD });
      }
      x += bw + irange(r, 6, 16);
      idx += 1;
    }
    return { tile, tw, speed: 11, blinkers, fans, signs: [] };
  }

  // ───────────── Rooftop foreground ─────────────

  private buildForeground(): void {
    const { W, H, groundY, floorY } = this;
    const fg = surface(W, H - groundY + 64);
    this.fg = fg;
    const c = fg.ctx;
    const oy = 64; // canvas row of groundY (room above for tall props)
    const r = rng(404);
    // Parapet lip + face
    px(c, 0, oy, W, 3, '#4b4b57');
    px(c, 0, oy, W, 1, '#8b8b9a');
    px(c, 0, oy + 2, W, 1, '#2f2f38');
    px(c, 0, oy + 3, W, 7, '#24232b');
    for (let x = (W % 14) >> 1; x < W; x += 14) px(c, x, oy + 3, 1, 7, '#1a1920');
    px(c, 0, oy + 3, W, 1, '#121117');
    // Tar & gravel roof floor, wider seams towards the viewer
    const floorTop = oy + 10;
    px(c, 0, floorTop, W, H - groundY - 10, '#17161e');
    let seam = 3;
    for (let y = floorTop + 2; y < oy + (H - groundY); y += seam) {
      px(c, 0, y, W, 1, '#1d1c25');
      seam += 2;
    }
    for (let i = 0; i < (W * (H - groundY)) / 18; i += 1) {
      const x = Math.floor(r() * W);
      const y = floorTop + Math.floor(r() * (H - groundY - 10));
      px(c, x, y, 1, 1, r() < 0.5 ? '#26252f' : '#0f0e14');
    }
    const fy = floorY - groundY + oy;
    // Racks (bodies drawn live with GPUs; shadows + cables baked)
    const many = W >= 300;
    const x0 = Math.max(6, Math.round(W * 0.05));
    const ids: string[][] = [['vx3080', 'nca100', 'nca100', 'qb9'], ['hydra', 'leviathan', 'prism', 'singularity']];
    this.racks = (many ? [0, 1] : [0]).map((i) => ({ x: x0 + i * (RACK_W + 5), y: floorY - RACK_H, gpus: ids[i].map((id) => GPU_BY_ID[id]) }));
    for (const rk of this.racks) {
      c.globalAlpha = 0.45;
      px(c, rk.x - 3, fy - 2, RACK_W + 6, 4, '#000000');
      c.globalAlpha = 1;
    }
    const lastRack = this.racks[this.racks.length - 1];
    const cableX = lastRack.x + RACK_W;
    px(c, cableX, fy - 3, 6, 1, '#09090b');
    px(c, cableX + 5, oy + 6, 1, fy - 3 - oy - 5, '#09090b');
    px(c, cableX + 5, oy + 6, 1, 1, '#facc15');
    // AC unit on the right
    const acW = 30;
    const acH = 20;
    this.acX = W - Math.max(6, Math.round(W * 0.05)) - acW;
    const ax = this.acX;
    const ay = fy - acH;
    c.globalAlpha = 0.45;
    px(c, ax - 2, fy - 2, acW + 4, 4, '#000000');
    c.globalAlpha = 1;
    px(c, ax - 1, ay - 1, acW + 2, acH + 1, OUTLINE);
    px(c, ax, ay, acW, acH, '#7c8798');
    px(c, ax, ay, acW, 1, '#c3cad6');
    px(c, ax, ay, 1, acH, '#a3acba');
    px(c, ax + acW - 1, ay, 1, acH, '#4b5563');
    px(c, ax, ay + acH - 2, acW, 2, '#4b5563');
    for (let gy = ay + 3; gy < ay + acH - 4; gy += 2) px(c, ax + 18, gy, 9, 1, '#4b5563');
    const fd = 13;
    px(c, ax + 2, ay + 3, fd + 2, fd + 2, '#1f2937');
    disc(c, ax + 3 + fd / 2, ay + 4 + fd / 2, fd / 2 + 1, '#111827');
    this.acFan = { x: ax + 3, y: ay + 4 - oy + groundY, d: fd };
    px(c, ax + 20, ay + acH - 5, 6, 1, '#22c55e');
    // Antenna mast at the far right of the parapet
    const mx = Math.min(W - 4, ax + acW + 2);
    px(c, mx, oy - 30, 1, 30, '#3f3f46');
    px(c, mx - 3, oy - 22, 7, 1, '#3f3f46');
    px(c, mx - 2, oy - 14, 5, 1, '#3f3f46');
    this.mast = { x: mx, y: groundY - 31 };
    // Coin pile ("the harvest") left of the AC unit
    const pcx = ax - 14;
    this.pile = { x: pcx, y: floorY };
    const rows = W >= 300 ? 4 : 3;
    for (let row = 0; row < rows; row += 1) {
      const n = rows - row;
      const yy = fy - 3 - row * 3;
      for (let k = 0; k < n; k += 1) {
        const cx = pcx - Math.round((n * 6) / 2) + k * 6 + (row % 2);
        px(c, cx, yy, 7, 3, OUTLINE);
        px(c, cx + 1, yy - 1, 5, 1, OUTLINE);
        px(c, cx + 1, yy, 5, 1, '#fde047');
        px(c, cx, yy + 1, 7, 1, '#facc15');
        px(c, cx + 1, yy + 2, 5, 1, '#a16207');
        px(c, cx + 2, yy, 1, 1, '#fffbeb');
      }
    }
    // Technician patrol path between the racks and the pile
    const wx0 = cableX + 8;
    const wx1 = Math.max(wx0 + 12, Math.min(wx0 + 90, pcx - Math.round(rows * 3) - 14));
    this.walk = { x0: wx0, x1: wx1 };
  }

  // ───────────── Vignette + calm centre ─────────────

  private buildOverlay(): void {
    const { W, H } = this;
    const ov = surface(W, H);
    this.overlay = ov;
    const img = ov.ctx.createImageData(W, H);
    const d = img.data;
    const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    const landscape = W >= H;
    const cx = W / 2;
    const cy = H * 0.56;
    const hw = landscape ? W * 0.2 : W * 0.46;
    const hh = H * (landscape ? 0.3 : 0.26);
    const step = 0.1;
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const ex = (x - cx) / (W / 2);
        const ey = (y - H / 2) / (H / 2);
        const edge = clamp((Math.sqrt(ex * ex + ey * ey) - 0.78) / 0.65, 0, 1) * 0.5;
        const bx = (x - cx) / hw;
        const by = (y - cy) / hh;
        const box = Math.pow(bx ** 4 + by ** 4, 0.25);
        const mid = clamp(1 - (box - 0.8) / 0.7, 0, 1) * 0.42;
        const v = 1 - (1 - edge) * (1 - mid);
        const q = Math.floor(v / step + bayer[(y & 3) * 4 + (x & 3)] / 16) * step;
        const i = (y * W + x) * 4;
        d[i] = 3;
        d[i + 1] = 2;
        d[i + 2] = 10;
        d[i + 3] = Math.round(clamp(q, 0, 1) * 255);
      }
    }
    ov.ctx.putImageData(img, 0, 0);
  }

  // ───────────── Particles ─────────────

  private seedFallers(): void {
    const { W, floorY } = this;
    if (!W) return;
    const area = (W * this.H) / (427 * 240);
    const n = Math.round((this.particles ? 18 : 6) * clamp(area, 0.6, 1.6));
    this.fallers = [];
    for (let i = 0; i < n; i += 1) {
      this.fallers.push({
        x: Math.random() * W,
        y: Math.random() * floorY,
        vy: 9 + Math.random() * 16,
        sway: 2 + Math.random() * 4,
        phase: Math.random() * 6.28,
        kind: Math.random() < 0.68 ? 0 : 1,
      });
    }
    const nd = Math.round((this.particles ? 34 : 10) * clamp(area, 0.6, 1.6));
    this.dust = [];
    for (let i = 0; i < nd; i += 1) {
      this.dust.push({ x: Math.random() * W, y: Math.random() * this.groundY, vy: 3 + Math.random() * 6, color: Math.random() < 0.6 ? '#a16207' : '#155e75' });
    }
    this.puffs = [];
    for (let i = 0; i < (this.particles ? 8 : 3); i += 1) this.puffs.push({ x: 0, y: 0, life: 0, max: 1 });
  }

  // ───────────── Per-frame ─────────────

  render(t: number, dt: number): void {
    const { ctx, W, groundY, floorY } = this;
    if (!this.sky || !this.fg || !this.overlay || !this.logo) return;
    ctx.globalAlpha = 1;
    ctx.drawImage(this.sky.canvas, 0, 0);
    // Twinkling stars
    for (const s of this.twinkles) {
      const k = (t * 0.9 + s.phase) % 3;
      if (k > 1.2) continue;
      const bright = k < 0.6;
      px(ctx, s.x, s.y, 1, 1, bright ? '#ffffff' : '#a5b4fc');
      if (s.big && bright) {
        px(ctx, s.x - 1, s.y, 1, 1, '#6366f1');
        px(ctx, s.x + 1, s.y, 1, 1, '#6366f1');
        px(ctx, s.x, s.y - 1, 1, 1, '#6366f1');
        px(ctx, s.x, s.y + 1, 1, 1, '#6366f1');
      }
    }
    // Shooting star every 9 s
    const cyc = Math.floor(t / 9);
    const ph = t - cyc * 9;
    if (ph < 0.8) {
      const sx0 = W * (0.15 + hashInt(cyc) * 0.6);
      const sy0 = groundY * (0.05 + hashInt(cyc + 7) * 0.25);
      const p = ph / 0.8;
      const hx = Math.round(sx0 + p * 70);
      const hy = Math.round(sy0 + p * 26);
      for (let k = 0; k < 8; k += 1) {
        ctx.globalAlpha = (1 - k / 8) * (1 - p * 0.6);
        px(ctx, hx - k * 2, hy - Math.round(k * 0.75), 2, 1, k === 0 ? '#ffffff' : '#c7d2fe');
      }
      ctx.globalAlpha = 1;
    }
    // Clouds
    for (const cl of this.clouds) {
      const span = W + cl.sprite.width;
      const x = Math.round(((cl.x0 + t * cl.speed) % span) - cl.sprite.width);
      ctx.drawImage(cl.sprite, x, cl.y);
    }
    // Far skyline, background "coin dust", mid skyline, datacenters
    this.drawLayer(this.layers[0], t);
    for (const d of this.dust) {
      d.y += d.vy * dt;
      if (d.y > groundY) {
        d.y = -2;
        d.x = Math.random() * W;
      }
      px(ctx, d.x, d.y, 1, 1, d.color);
    }
    this.drawLayer(this.layers[1], t);
    this.drawLayer(this.layers[2], t);
    // Falling coins & data blocks
    const coinFrameBase = Math.floor(t * 8);
    for (const f of this.fallers) {
      f.y += f.vy * dt;
      if (f.y > floorY - 4) {
        f.y = -8 - Math.random() * 20;
        f.x = Math.random() * W;
      }
      const x = Math.round(f.x + Math.sin(t * 1.3 + f.phase) * f.sway);
      const y = Math.round(f.y);
      if (f.kind === 0) ctx.drawImage(sprites.coin(coinFrameBase + Math.floor(f.phase * 3)), x, y);
      else ctx.drawImage(sprites.dataBlock(), x, y);
    }
    // Rooftop
    ctx.drawImage(this.fg.canvas, 0, groundY - 64);
    this.drawRooftop(t, dt);
    // Vignette / calm centre
    ctx.drawImage(this.overlay.canvas, 0, 0);
    this.drawLogo(t);
  }

  private drawLayer(layer: Layer, t: number): void {
    const { ctx, W } = this;
    const off = Math.floor(t * layer.speed) % layer.tw;
    const fanFrame = Math.floor(t * 14);
    for (let x0 = -off; x0 < W; x0 += layer.tw) {
      ctx.drawImage(layer.tile.canvas, x0, 0);
      for (const b of layer.blinkers) {
        const bx = x0 + b.x;
        if (bx < -1 || bx > W) continue;
        const on = (t + b.phase) % b.period < b.period * b.duty;
        if (on === b.baked) continue;
        px(ctx, bx, b.y, b.w, b.h, on ? b.on : b.off);
        if (on && b.lo) px(ctx, bx, b.y + b.h - 1, b.w, 1, b.lo);
        if (b.cross && on) {
          ctx.globalAlpha = 0.6;
          px(ctx, bx - 1, b.y, 1, 1, b.on);
          px(ctx, bx + 1, b.y, 1, 1, b.on);
          px(ctx, bx, b.y - 1, 1, 1, b.on);
          px(ctx, bx, b.y + 1, 1, 1, b.on);
          ctx.globalAlpha = 1;
        }
      }
      for (let i = 0; i < layer.fans.length; i += 1) {
        const f = layer.fans[i];
        const fx = x0 + f.x;
        if (fx < -f.d || fx > W) continue;
        ctx.drawImage(sprites.fan(f.d, fanFrame + i, '#64748b', '#1e293b'), fx, f.y);
      }
      for (const s of layer.signs) {
        const sx = x0 + s.x;
        if (sx < -s.on.width || sx > W) continue;
        const flick = hashInt(Math.floor(t * 12) * 31 + s.seed);
        const dark = flick < 0.05 || (hashInt(Math.floor(t * 0.5) + s.seed) < 0.2 && flick < 0.4);
        if (!dark) ctx.drawImage(s.on, sx, s.y);
      }
    }
  }

  private drawRooftop(t: number, dt: number): void {
    const { ctx } = this;
    // Racks with live GPUs, fans and PSU LEDs
    const rack = RACK_BY_ID.steel;
    const cooler = COOLER_BY_ID.fan120;
    const psu = PSU_BY_ID.psu2000;
    this.racks.forEach((rk, ri) => {
      ctx.drawImage(sprites.rackBody(rack.style, rack.slots, rack.fanSlots), rk.x, rk.y);
      rk.gpus.forEach((gm, i) => {
        const r = gpuSlotRect(rack.slots, i);
        sprites.drawGpu(ctx, gm, rk.x + r.x, rk.y + r.y, r.w, r.h, t + ri * 0.3, RUNNING);
      });
      for (let i = 0; i < rack.fanSlots; i += 1) {
        const r = fanSlotRect(i);
        ctx.drawImage(sprites.cooler(cooler, r.w, r.h, Math.floor(t * 16) + i + ri), rk.x + r.x, rk.y + r.y);
      }
      ctx.drawImage(sprites.psu(psu, PSU_RECT.w, PSU_RECT.h), rk.x + PSU_RECT.x, rk.y + PSU_RECT.y);
      px(ctx, rk.x + PSU_RECT.x + PSU_RECT.w - 3, rk.y + PSU_RECT.y + 1, 2, 2, '#22c55e');
      // Status panel ticker
      const blink = Math.floor(t * 3 + ri) % 2 === 0;
      px(ctx, rk.x + 4, rk.y + 3, 2, 1, blink ? '#22c55e' : '#14532d');
      px(ctx, rk.x + 7, rk.y + 3, 2, 1, blink ? '#14532d' : '#22d3ee');
    });
    // AC fan + heat puffs
    const fan = this.acFan;
    ctx.drawImage(sprites.fan(fan.d, Math.floor(t * 18), '#cbd5e1', '#334155'), fan.x, fan.y);
    const ventX = this.acX + 18;
    const ventY = fan.y - 5;
    for (let i = 0; i < this.puffs.length; i += 1) {
      const p = this.puffs[i];
      p.life -= dt;
      if (p.life <= 0) {
        if (dt > 0 && Math.random() < dt * 2.5) {
          p.max = 1.6 + Math.random();
          p.life = p.max;
          p.x = ventX + Math.random() * 9;
          p.y = ventY;
        }
        continue;
      }
      p.y -= 9 * dt;
      p.x += Math.sin(t * 2 + i) * 4 * dt;
      const a = p.life / p.max;
      const s = 2 + Math.round((1 - a) * 3);
      ctx.globalAlpha = a * 0.35;
      px(ctx, p.x, p.y, s, s, '#9ca3af');
    }
    ctx.globalAlpha = 1;
    // Antenna beacon
    if (t % 1.5 < 0.4) {
      px(ctx, this.mast.x - 1, this.mast.y, 3, 1, '#ef4444');
      px(ctx, this.mast.x, this.mast.y - 1, 1, 3, '#ef4444');
      px(ctx, this.mast.x, this.mast.y, 1, 1, '#fecaca');
    } else px(ctx, this.mast.x, this.mast.y, 1, 1, '#7f1d1d');
    // Glint on the coin pile
    const g = t % 2.4;
    if (g < 0.5) {
      const gx = this.pile.x - 3 + Math.round(hashInt(Math.floor(t / 2.4)) * 8);
      const gy = this.pile.y - 9;
      const big = g < 0.25;
      px(ctx, gx, gy, 1, 1, '#ffffff');
      if (big) {
        px(ctx, gx - 1, gy, 3, 1, '#fef9c3');
        px(ctx, gx, gy - 1, 1, 3, '#fef9c3');
      }
    }
    // Technician: walk out, inspect the pile, walk back, service the rack
    const { x0, x1 } = this.walk;
    const dist = x1 - x0;
    const walkT = dist / 14;
    const cycle = walkT * 2 + 5;
    const k = t % cycle;
    let tx = x0;
    let facingLeft = false;
    let working = false;
    let moving = false;
    if (k < walkT) {
      tx = x0 + (k / walkT) * dist;
      moving = true;
    } else if (k < walkT + 1.5) {
      tx = x1;
    } else if (k < walkT * 2 + 1.5) {
      tx = x1 - ((k - walkT - 1.5) / walkT) * dist;
      facingLeft = true;
      moving = true;
    } else {
      tx = x0;
      facingLeft = true;
      working = true;
    }
    const frame = moving ? Math.floor(t * 8) : working ? Math.floor(t * 4) : 0;
    const spr = sprites.technician(frame, '#2563eb', working);
    const sx = Math.round(tx);
    const sy = this.floorY - 16;
    ctx.globalAlpha = 0.4;
    px(ctx, sx + 1, this.floorY - 1, 8, 2, '#000000');
    ctx.globalAlpha = 1;
    if (facingLeft) {
      ctx.save();
      ctx.translate(sx + 10, sy);
      ctx.scale(-1, 1);
      ctx.drawImage(spr, 0, 0);
      ctx.restore();
    } else ctx.drawImage(spr, sx, sy);
    if (working && Math.floor(t * 8) % 5 === 0) px(ctx, sx - 2, sy + 7, 1, 1, '#fde047');
  }

  private drawLogo(t: number): void {
    const { ctx } = this;
    const logo = this.logo;
    if (!logo) return;
    const bob = Math.round(Math.sin(t * 1.7) * 1.6);
    const lx = this.logoX;
    const ly = this.logoY + bob;
    const LW = logo.canvas.width;
    const LH = logo.canvas.height;
    // Drop shadow so the logo pops off the sky
    if (this.logoShadow) {
      ctx.globalAlpha = 0.6;
      ctx.drawImage(this.logoShadow.canvas, lx + 2, ly + 3);
      ctx.globalAlpha = 1;
    }
    ctx.drawImage(logo.canvas, lx, ly);
    // Shine sweep (diagonal band clipped to the letter faces)
    const period = 5;
    const p = (t % period) / 1.3;
    if (p < 1) {
      const s = Math.round(-LH / 2 - 10 + p * (LW + LH / 2 + 20));
      const runs = this.shineRuns;
      const rows = this.shineRow;
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = '#ffffff';
      for (let y = 0; y < LH; y += 1) {
        // 2:1 staircase diagonal: a wide band and a thin trailing band
        const bx = s + ((LH - y) >> 1);
        for (let k = rows[y]; k < rows[y + 1]; k += 2) {
          const a = runs[k];
          const b = runs[k + 1];
          if (b <= bx || a >= bx + 11) continue;
          const w0 = Math.max(a, bx);
          const w1 = Math.min(b, bx + 6);
          if (w1 > w0) ctx.fillRect(lx + w0, ly + y, w1 - w0, 1);
          const n0 = Math.max(a, bx + 9);
          const n1 = Math.min(b, bx + 11);
          if (n1 > n0) ctx.fillRect(lx + n0, ly + y, n1 - n0, 1);
        }
      }
      ctx.globalAlpha = 1;
    }
    // Spinning coins on the ribbon
    const coinS = this.ribbonCoinScale;
    const coinSpr = sprites.coin(Math.floor(t * 6));
    this.ribbonCoins.forEach((c) => {
      const spr = coinSpr;
      ctx.drawImage(spr, lx + c.x, ly + c.y, 7 * coinS, 7 * coinS);
    });
    // Sparkles hopping between letters
    const n = this.logoSparkles.length;
    if (n) {
      const slot = Math.floor(t / 0.9);
      const sp = this.logoSparkles[Math.floor(hashInt(slot) * n)];
      const local = (t % 0.9) / 0.9;
      const r = local < 0.5 ? Math.round(local * 6) : Math.round((1 - local) * 6);
      const x = lx + sp.x;
      const y = ly + sp.y;
      px(ctx, x, y, 1, 1, '#ffffff');
      if (r >= 1) {
        px(ctx, x - r, y, r * 2 + 1, 1, '#fef9c3');
        px(ctx, x, y - r, 1, r * 2 + 1, '#fef9c3');
        px(ctx, x, y, 1, 1, '#ffffff');
      }
    }
  }
}
