/**
 * Procedural pixel-art sprite factory. Every sprite in the game is drawn with
 * fillRect on small canvases, cached, and reused — no external images.
 */
import { COIN_INFO } from '../config/altcoins';
import { COOLER_BY_ID, GPU_BY_ID, PSU_BY_ID, RACK_BY_ID } from '../config/hardwareCatalog';
import { ROOM_BY_ID } from '../config/roomsCatalog';
import type { CoinId } from '../types/economy';
import type { CoolerModel, GpuModel, PsuModel, RackStyle } from '../types/hardware';
import type { RoomId } from '../types/player';

type Ctx = CanvasRenderingContext2D;

// ───────────────────────── helpers ─────────────────────────

export const px = (ctx: Ctx, x: number, y: number, w: number, h: number, color: string): void => {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
};

/** Lighten (amt > 0) or darken (amt < 0) a #rrggbb color. */
export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.round(Math.min(255, Math.max(0, amt >= 0 ? v + (255 - v) * amt : v * (1 + amt))));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** Deterministic hash → [0,1) for stable "random" details. */
export function hash01(seed: string, i = 0): number {
  let h = 2166136261 ^ i;
  for (let k = 0; k < seed.length; k += 1) {
    h ^= seed.charCodeAt(k);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

// ───────────────────────── 3×5 bitmap font ─────────────────────────

const GLYPHS: Record<string, string> = {
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111',
  '4': '101101111001001', '5': '111100111001111', '6': '111100111101111', '7': '111001010010010',
  '8': '111101111101111', '9': '111101111001111', '.': '000000000000010', ',': '000000000010100',
  '+': '000010111010000', '-': '000000111000000', '$': '011110010011110', '%': '101001010100101',
  '/': '001001010100100', ':': '000010000010000', ' ': '000000000000000', '°': '010101010000000',
  '!': '010010010000010', '?': '111001010000010', '#': '101111101111101', 'x': '000101010101000',
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110',
  E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101',
  I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111',
  M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100',
  Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101',
  Y: '101101010010010', Z: '111001010100111',
  'Ñ': '111000110101101', '¡': '010000010010010', '¿': '010000010100111', '<': '001010100010001', '>': '100010001010100',
  '=': '000111000111000', '*': '000101010101000', "'": '010010000000000', '(': '001010010010001', ')': '100010010010100',
  '~': '000011110000000', '_': '000000000000111',
};

const COMBINING_MARKS = /[\u0300-\u036f]/g;
const glyphText = new Map<string, string>();

/**
 * Text as the 3×5 font can draw it: upper case, accents stripped (Á → A, Ü → U; a 3×5 cell has no room
 * for them) while Ñ keeps its own glyph. Every language therefore renders clean labels instead of "?".
 */
export function pixelTextOf(text: string): string {
  let out = glyphText.get(text);
  if (out === undefined) {
    out = text
      .toUpperCase()
      .replace(/Ñ/g, '\u0001')
      .normalize('NFD')
      .replace(COMBINING_MARKS, '')
      .replace(/\u0001/g, 'Ñ')
      .replace(/[—–]/g, '-')
      .replace(/×/g, 'x')
      .replace(/·/g, '.');
    if (glyphText.size > 4000) glyphText.clear();
    glyphText.set(text, out);
  }
  return out;
}

/** Rack state icons drawn above a rack (see `SpriteManager.statusIcon`). */
export type StatusIconKind = 'overheat' | 'overload' | 'no_psu' | 'reboot' | 'empty' | 'blackout' | 'condensation' | 'throttle';

export interface TextOpts {
  scale?: number;
  shadow?: string;
  align?: 'left' | 'center' | 'right';
}

export function measurePixelText(text: string, scale = 1): number {
  return Math.max(0, pixelTextOf(text).length * 4 - 1) * scale;
}

export function drawPixelText(ctx: Ctx, text: string, x: number, y: number, color: string, opts: TextOpts = {}): number {
  const scale = opts.scale ?? 1;
  const upper = pixelTextOf(text);
  const width = Math.max(0, upper.length * 4 - 1) * scale;
  let cx = Math.round(opts.align === 'center' ? x - width / 2 : opts.align === 'right' ? x - width : x);
  const cy = Math.round(y);
  const paint = (ox: number, oy: number, c: string) => {
    let gx = cx + ox;
    for (const ch of upper) {
      const g = GLYPHS[ch] ?? GLYPHS[ch.toUpperCase()] ?? GLYPHS['?'];
      for (let i = 0; i < 15; i += 1) {
        if (g[i] === '1') px(ctx, gx + (i % 3) * scale, cy + oy + Math.floor(i / 3) * scale, scale, scale, c);
      }
      gx += 4 * scale;
    }
  };
  if (opts.shadow) paint(scale, scale, opts.shadow);
  paint(0, 0, color);
  cx += width;
  return width;
}

// ───────────────────────── Layout constants ─────────────────────────

export const RACK_W = 40;
export const RACK_H = 64;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const gpuSlotRect = (slots: number, i: number): Rect => {
  const sh = Math.floor(48 / slots);
  return { x: 3, y: 9 + i * sh, w: 25, h: sh - 1 };
};

export const fanSlotRect = (i: number): Rect => ({ x: 29, y: 9 + i * 12, w: 9, h: 11 });

export const PSU_RECT: Rect = { x: 3, y: 57, w: 35, h: 5 };

export interface FanSpot {
  cx: number;
  cy: number;
  d: number;
}

/** Positions of the fans on a GPU body of a given size. */
export function gpuFanLayout(model: GpuModel, w: number, h: number): FanSpot[] {
  if (model.style === 'singularity') return [];
  if (h < 8) {
    const d = Math.max(3, h - 1);
    const count = Math.min(model.fans, Math.floor((w - 6) / (d + 1)));
    const span = w - 6;
    return Array.from({ length: count }, (_, i) => ({ cx: 4 + ((i + 0.5) * span) / count, cy: (h - 1) / 2, d }));
  }
  if (model.style === 'asic') {
    const d = h - 4;
    return [{ cx: 2 + d / 2, cy: (h - 2) / 2, d }, { cx: w - 2 - d / 2, cy: (h - 2) / 2, d }];
  }
  if (model.style === 'photonic') {
    const d = Math.min(h - 5, 9);
    return [{ cx: w - 4 - d / 2, cy: (h - 3) / 2, d }];
  }
  const d = Math.max(3, Math.min(h - 5, Math.floor((w - 8) / model.fans) - 1));
  const span = w - 8;
  return Array.from({ length: model.fans }, (_, i) => ({ cx: 4 + ((i + 0.5) * span) / model.fans, cy: (h - 4) / 2, d }));
}

export interface GpuDrawState {
  running: boolean;
  load: number;
  temp: number;
  shutdown: boolean;
  throttled: boolean;
}

export const ledColorFor = (st: GpuDrawState, t: number): string => {
  if (st.shutdown) return Math.floor(t * 2) % 2 === 0 ? '#ef4444' : '#450a0a';
  if (!st.running) return '#3f3f46';
  if (st.throttled) return Math.floor(t * 5) % 2 === 0 ? '#ef4444' : '#7f1d1d';
  if (st.temp >= 80) return '#f97316';
  if (st.temp >= 70) return '#facc15';
  return '#22c55e';
};

// ───────────────────────── Sprite manager ─────────────────────────

export class SpriteManager {
  private cache = new Map<string, HTMLCanvasElement>();
  private urls = new Map<string, string>();

  private make(key: string, w: number, h: number, draw: (ctx: Ctx) => void): HTMLCanvasElement {
    const hit = this.cache.get(key);
    if (hit) return hit;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w));
    canvas.height = Math.max(1, Math.round(h));
    const ctx = canvas.getContext('2d') as Ctx;
    ctx.imageSmoothingEnabled = false;
    draw(ctx);
    this.cache.set(key, canvas);
    return canvas;
  }

  private url(key: string, build: () => HTMLCanvasElement): string {
    const hit = this.urls.get(key);
    if (hit) return hit;
    const data = build().toDataURL('image/png');
    this.urls.set(key, data);
    return data;
  }

  // ── Fans (4-frame rotating spritesheet) ──
  fan(d: number, frame: number, tint = '#a1a1aa', ring = '#27272a'): HTMLCanvasElement {
    const size = Math.max(3, Math.round(d));
    const f = ((frame % 4) + 4) % 4;
    return this.make(`fan:${size}:${f}:${tint}:${ring}`, size, size, (ctx) => {
      const R = size / 2;
      const blades = size >= 7 ? 5 : 3;
      const period = (Math.PI * 2) / blades;
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const dx = x + 0.5 - R;
          const dy = y + 0.5 - R;
          const r = Math.hypot(dx, dy);
          if (r > R) continue;
          if (r > R - 1 && size >= 5) {
            px(ctx, x, y, 1, 1, ring);
          } else if (r < Math.max(0.9, R * 0.3)) {
            px(ctx, x, y, 1, 1, r < 0.8 ? shade(tint, 0.4) : '#52525b');
          } else {
            const a = Math.atan2(dy, dx) + (f * period) / 4;
            const m = ((a % period) + period) % period;
            px(ctx, x, y, 1, 1, m < period * 0.5 ? shade(tint, -0.25 * (r / R)) : '#0c0c10');
          }
        }
      }
    });
  }

  // ── GPU body (static part: shroud, PCB, bracket) ──
  gpuBody(model: GpuModel, w: number, h: number): HTMLCanvasElement {
    return this.make(`gpu:${model.id}:${w}x${h}`, w, h, (ctx) => {
      const p = model.palette;
      const outline = '#07070b';
      const spots = gpuFanLayout(model, w, h);
      if (h < 8) {
        px(ctx, 0, 0, w, h, outline);
        px(ctx, 0, 0, 1, h, '#9ca3af');
        px(ctx, 1, 0, w - 1, h - 1, p.shroud);
        px(ctx, 1, 0, w - 1, 1, shade(p.shroud, 0.3));
        px(ctx, 1, h - 1, w - 1, 1, p.pcb);
        px(ctx, w - 4, h - 2, 3, 1, p.accent);
        spots.forEach((s) => this.disc(ctx, s.cx, s.cy, s.d / 2 + 0.3, '#09090b'));
        return;
      }
      if (model.style === 'asic') {
        px(ctx, 0, 0, w, h - 1, outline);
        px(ctx, 1, 1, w - 2, h - 3, p.shroud);
        for (let x = 3; x < w - 3; x += 2) px(ctx, x, 2, 1, h - 5, p.shroudDark);
        px(ctx, 1, 1, w - 2, 1, shade(p.shroud, 0.35));
        const lw = Math.min(14, w - 16);
        px(ctx, w / 2 - lw / 2, 2, lw, Math.max(2, h - 7), '#f8fafc');
        px(ctx, w / 2 - lw / 2, 2, lw, 1, p.accent);
        px(ctx, w / 2 - lw / 2 + 1, 4, lw - 2, 1, '#94a3b8');
        spots.forEach((s) => this.disc(ctx, s.cx, s.cy, s.d / 2 + 0.6, '#0b0b0f'));
        px(ctx, 1, h - 2, w - 2, 1, p.shroudDark);
        return;
      }
      if (model.style === 'photonic') {
        px(ctx, 0, 0, w, h - 1, outline);
        px(ctx, 1, 1, w - 2, h - 3, p.shroudDark);
        for (let x = 2; x < w - 2; x += 3) px(ctx, x, 1, 1, h - 3, shade(p.shroudDark, 0.12));
        px(ctx, 1, 1, w - 2, 1, shade(p.shroud, 0.3));
        // Prism + refraction lines
        const pcx = Math.round(w * 0.36);
        const ph = h - 5;
        for (let i = 0; i < ph; i += 1) {
          const half = Math.floor((i * 0.6) + 0.5);
          px(ctx, pcx - half, 2 + i, half * 2 + 1, 1, shade(p.accent, -0.1 + (i / ph) * -0.3));
        }
        px(ctx, pcx, 2, 1, 1, '#ffffff');
        ['#f87171', '#facc15', '#4ade80', '#22d3ee'].forEach((c, i) => px(ctx, pcx + 4, 3 + i * Math.max(1, Math.floor(ph / 5)), Math.round(w * 0.28), 1, c));
        spots.forEach((s) => this.disc(ctx, s.cx, s.cy, s.d / 2 + 0.6, '#050508'));
        px(ctx, 1, h - 2, w - 2, 1, p.pcb);
        return;
      }
      if (model.style === 'singularity') {
        px(ctx, 0, 0, w, h - 1, outline);
        px(ctx, 1, 1, w - 2, h - 3, p.shroud);
        for (let x = 2; x < w - 2; x += 4) px(ctx, x, 1, 2, 1, shade(p.accent, -0.4));
        px(ctx, 1, h - 3, w - 2, 1, shade(p.shroud, -0.4));
        px(ctx, 1, h - 2, w - 2, 1, p.pcb);
        return;
      }
      // Classic graphics card
      px(ctx, 0, 0, w, h - 1, outline);
      px(ctx, 0, 0, 2, h - 1, '#a1a1aa');
      for (let y = 2; y < h - 3; y += 2) px(ctx, 0, y, 1, 1, '#52525b');
      px(ctx, 2, 0, w - 2, h - 3, p.shroudDark);
      px(ctx, 3, 1, w - 4, h - 5, p.shroud);
      px(ctx, 3, 1, w - 4, 1, shade(p.shroud, 0.35));
      px(ctx, 3, h - 5, w - 4, 1, shade(p.shroud, -0.25));
      // Heatsink fins peeking between fans
      for (let x = 4; x < w - 2; x += 2) px(ctx, x, h - 4, 1, 1, shade(p.shroudDark, 0.2));
      // Accent livery
      px(ctx, w - 9, 1, 6, 1, p.accent);
      px(ctx, 4, h - 5, Math.max(3, Math.floor(w * 0.25)), 1, p.accent);
      spots.forEach((s) => this.disc(ctx, s.cx, s.cy, s.d / 2 + 0.6, '#0b0b0f'));
      // PCB with SMD components and PCIe gold fingers
      px(ctx, 2, h - 3, w - 2, 2, p.pcb);
      for (let i = 0; i < 6; i += 1) {
        px(ctx, 4 + Math.floor(hash01(model.id, i) * (w - 8)), h - 3, 1, 1, i % 2 ? '#d4d4d8' : '#78716c');
      }
      const fingers = Math.floor(w * 0.45);
      for (let x = 0; x < fingers; x += 1) px(ctx, 7 + x, h - 1, 1, 1, x % 2 === 0 ? '#facc15' : '#a16207');
      // 8-pin power plug
      px(ctx, w - 6, 0, 3, 1, '#18181b');
    });
  }

  private disc(ctx: Ctx, cx: number, cy: number, r: number, color: string): void {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y += 1) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x += 1) {
        if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r) px(ctx, x, y, 1, 1, color);
      }
    }
  }

  /** Full animated GPU: cached body + spinning fan frames + live LEDs. */
  drawGpu(ctx: Ctx, model: GpuModel, x: number, y: number, w: number, h: number, t: number, st: GpuDrawState): void {
    ctx.drawImage(this.gpuBody(model, w, h), x, y);
    const spin = st.running ? 6 + st.load * 14 : 0;
    const frame = Math.floor(t * spin);
    const tint = model.style === 'asic' ? '#cbd5e1' : model.style === 'photonic' ? '#67e8f9' : '#a1a1aa';
    gpuFanLayout(model, w, h).forEach((s, i) => {
      const fanCanvas = this.fan(s.d, frame + i, tint);
      ctx.drawImage(fanCanvas, Math.round(x + s.cx - s.d / 2), Math.round(y + s.cy - s.d / 2));
    });
    const led = ledColorFor(st, t);
    if (model.style === 'singularity') {
      const cx = x + w / 2;
      const cy = y + (h - 3) / 2;
      const r = Math.max(1.5, Math.min(w, h) / 2 - 2.5);
      this.disc(ctx, cx, cy, r + 1, shade(model.palette.accent, -0.5));
      this.disc(ctx, cx, cy, r, '#000000');
      const rot = st.running ? t * (2 + st.load * 3) : 0;
      for (let k = 0; k < 10; k += 1) {
        const a = rot + (k / 10) * Math.PI * 2;
        const rx = Math.cos(a) * (r + 2.2);
        const ry = Math.sin(a) * (r + 2.2) * 0.45;
        px(ctx, cx + rx, cy + ry, 1, 1, k % 3 === 0 ? '#ffffff' : model.palette.accent);
      }
      px(ctx, x + w - 4, y + 1, 2, 1, led);
      return;
    }
    if (model.style === 'photonic' && st.running && h >= 8) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 6);
      ctx.globalAlpha = 0.35 + pulse * 0.4;
      px(ctx, x + Math.round(w * 0.36), y + 2, 1, h - 5, '#ffffff');
      ctx.globalAlpha = 1;
    }
    if (h < 8) px(ctx, x + w - 2, y, 1, Math.max(1, h - 2), led);
    else px(ctx, x + w - 7, y + h - 4, 4, 1, led);
  }

  // ── Coolers ──
  cooler(model: CoolerModel, w: number, h: number, frame: number): HTMLCanvasElement {
    const f = ((frame % 4) + 4) % 4;
    return this.make(`cool:${model.id}:${w}x${h}:${f}`, w, h, (ctx) => {
      const d = Math.min(w, h) - 2;
      const ox = (w - d) / 2;
      const oy = (h - d) / 2;
      switch (model.kind) {
        case 'air': {
          px(ctx, 0, 0, w, h, '#27272a');
          px(ctx, 0, 0, w, 1, '#52525b');
          [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]].forEach(([cx, cy]) => px(ctx, cx, cy, 1, 1, '#a1a1aa'));
          const tint = model.id === 'fan120' ? '#60a5fa' : '#a1a1aa';
          const ring = model.id === 'fan120' ? '#1d4ed8' : '#3f3f46';
          ctx.drawImage(this.fan(d, f, tint, ring), ox, oy);
          if (model.id === 'tower') {
            for (let y = 1; y < h - 1; y += 2) px(ctx, 0, y, 1, 1, '#b45309');
            for (let y = 1; y < h - 1; y += 2) px(ctx, w - 1, y, 1, 1, '#b45309');
          }
          break;
        }
        case 'liquid': {
          px(ctx, 0, 0, w, h, '#0f172a');
          for (let y = 1; y < h - 1; y += 2) px(ctx, 1, y, w - 2, 1, '#1e293b');
          ctx.drawImage(this.fan(Math.max(3, d - 1), f, '#38bdf8', '#0369a1'), ox + 0.5, oy + 0.5);
          px(ctx, 0, 0, 1, h, '#111827');
          px(ctx, w - 1, 1, 1, 2, '#38bdf8');
          break;
        }
        case 'immersion': {
          px(ctx, 0, 0, w, h, '#94a3b8');
          px(ctx, 1, 1, w - 2, h - 2, '#0e7490');
          px(ctx, 1, 1, w - 2, 1, '#67e8f9');
          px(ctx, 2, Math.floor(h / 2), w - 4, Math.ceil(h / 2) - 2, '#155e75');
          for (let i = 0; i < 4; i += 1) {
            const bx = 1 + Math.floor(hash01('bub', i) * (w - 2));
            const by = h - 2 - (((f + i * 3) * 2) % (h - 2));
            px(ctx, bx, by, 1, 1, '#cffafe');
          }
          break;
        }
        case 'cryo': {
          px(ctx, 0, 0, w, h, '#e0f2fe');
          px(ctx, 1, 1, w - 2, h - 2, '#bae6fd');
          for (let i = 0; i < 6; i += 1) px(ctx, Math.floor(hash01('ice', i) * w), Math.floor(hash01('ice', i + 9) * h), 1, 1, '#ffffff');
          px(ctx, 2, h - 3, w - 4, 1, f % 2 === 0 ? '#38bdf8' : '#0284c7');
          px(ctx, Math.floor(w / 2) - 1, 2, 2, 2, '#0c4a6e');
          break;
        }
        default:
          break;
      }
    });
  }

  psu(model: PsuModel, w: number, h: number): HTMLCanvasElement {
    return this.make(`psu:${model.id}:${w}x${h}`, w, h, (ctx) => {
      px(ctx, 0, 0, w, h, '#09090b');
      px(ctx, 1, 0, w - 2, h - 1, '#27272a');
      px(ctx, 1, 0, w - 2, 1, '#3f3f46');
      px(ctx, 2, 1, Math.min(8, w - 4), Math.max(1, h - 3), model.color);
      for (let x = 12; x < w - 4; x += 2) px(ctx, x, 1, 1, Math.max(1, h - 3), '#18181b');
    });
  }

  // ── Rack chassis ──
  rackBody(style: RackStyle, slots: number, fanSlots: number): HTMLCanvasElement {
    return this.make(`rack:${style}:${slots}:${fanSlots}`, RACK_W, RACK_H, (ctx) => {
      const W = RACK_W;
      const H = RACK_H;
      const pal = {
        bench: { outer: '#a1a1aa', light: '#e4e4e7', dark: '#52525b', inner: '#1f1f24' },
        steel: { outer: '#52525b', light: '#a1a1aa', dark: '#27272a', inner: '#111114' },
        cabinet: { outer: '#18181b', light: '#3f3f46', dark: '#09090b', inner: '#08080a' },
        gold: { outer: '#ca8a04', light: '#fde047', dark: '#713f12', inner: '#1c1917' },
      }[style];
      if (style === 'bench') {
        px(ctx, 2, 8, W - 4, H - 10, pal.inner);
        px(ctx, 0, 0, 2, H, pal.outer);
        px(ctx, W - 2, 0, 2, H, pal.outer);
        px(ctx, 0, 0, 1, H, pal.light);
        px(ctx, 0, 0, W, 2, pal.outer);
        px(ctx, 0, 0, W, 1, pal.light);
        px(ctx, 0, H - 2, W, 2, pal.dark);
        for (let i = 1; i < slots; i += 1) {
          const r = gpuSlotRect(slots, i);
          px(ctx, 2, r.y - 1, W - 4, 1, '#3f3f46');
        }
      } else {
        px(ctx, 0, 0, W, H, pal.dark);
        px(ctx, 0, 0, W - 1, H - 1, pal.outer);
        px(ctx, 0, 0, W - 1, 1, pal.light);
        px(ctx, 0, 0, 1, H - 1, pal.light);
        px(ctx, 2, 8, W - 4, H - 10, pal.inner);
        [[1, 1], [W - 3, 1], [1, H - 3], [W - 3, H - 3]].forEach(([x, y]) => px(ctx, x, y, 1, 1, style === 'gold' ? '#fef9c3' : '#d4d4d8'));
        if (style === 'cabinet') {
          for (let y = 9; y < H - 3; y += 2) {
            px(ctx, 1, y, 1, 1, '#3f3f46');
            px(ctx, W - 2, y, 1, 1, '#3f3f46');
          }
        }
        if (style === 'gold') {
          for (let y = 10; y < H - 4; y += 6) {
            px(ctx, 1, y, 1, 2, '#fef08a');
            px(ctx, W - 2, y, 1, 2, '#fef08a');
          }
          // little crown
          px(ctx, 17, 0, 6, 1, '#fef08a');
        }
        for (let i = 0; i < slots; i += 1) {
          const r = gpuSlotRect(slots, i);
          px(ctx, r.x - 1, r.y + Math.floor(r.h / 2), 1, 1, '#71717a');
        }
      }
      // Top status panel
      px(ctx, 3, 2, W - 6, 5, '#050506');
      px(ctx, 27, 2, 10, 5, '#e5e7eb');
      px(ctx, 28, 6, 8, 1, '#9ca3af');
      px(ctx, 27, 2, 1, 1, '#ef4444');
      // Fan column background (mesh)
      px(ctx, 29, 9, 9, 48, '#0a0a0c');
      for (let y = 10; y < 56; y += 2) for (let x = 30; x < 37; x += 2) px(ctx, x, y, 1, 1, '#18181b');
      for (let i = 0; i < fanSlots; i += 1) {
        const r = fanSlotRect(i);
        px(ctx, r.x, r.y, r.w, r.h, '#131316');
      }
      // GPU bays
      for (let i = 0; i < slots; i += 1) {
        const r = gpuSlotRect(slots, i);
        px(ctx, r.x, r.y, r.w, r.h, '#0d0d10');
        px(ctx, r.x + 4, r.y + r.h - 1, 12, 1, '#27272a');
      }
      // PSU bay
      px(ctx, PSU_RECT.x, PSU_RECT.y, PSU_RECT.w, PSU_RECT.h, '#060607');
    });
  }

  // ── Characters & pickups ──
  technician(frame: number, shirt: string, working: boolean): HTMLCanvasElement {
    const f = working ? 4 + (frame % 2) : frame % 4;
    return this.make(`tech:${f}:${shirt}`, 10, 16, (ctx) => {
      const skin = '#f2c18f';
      const hair = '#3f2a1d';
      const cap = '#facc15';
      const pants = '#1e3a8a';
      const shoe = '#1c1917';
      px(ctx, 3, 0, 4, 1, cap);
      px(ctx, 2, 1, 6, 1, cap);
      px(ctx, 6, 1, 3, 1, shade(cap, -0.25));
      px(ctx, 2, 2, 1, 2, hair);
      px(ctx, 3, 2, 4, 3, skin);
      px(ctx, 6, 3, 1, 1, '#111827');
      px(ctx, 4, 5, 2, 1, shade(skin, -0.15));
      px(ctx, 2, 6, 6, 5, shirt);
      px(ctx, 2, 6, 6, 1, shade(shirt, 0.25));
      px(ctx, 4, 7, 1, 1, '#fef08a');
      px(ctx, 2, 10, 6, 1, '#3f3f46');
      px(ctx, 6, 10, 1, 1, '#facc15');
      const swing = f < 4 ? [0, 1, 0, -1][f] : 0;
      if (f >= 4) {
        px(ctx, 7, 6, 2, 2, shirt);
        px(ctx, 8, 7, 2, 1, skin);
        px(ctx, 9, f === 4 ? 6 : 7, 1, 2, '#e5e7eb');
        px(ctx, 1, 7, 1, 3, shirt);
        px(ctx, 1, 10, 1, 1, skin);
      } else {
        px(ctx, 1, 7 + Math.max(0, swing), 1, 3, shirt);
        px(ctx, 1, 10 + Math.max(0, swing), 1, 1, skin);
        px(ctx, 8, 7 + Math.max(0, -swing), 1, 3, shirt);
        px(ctx, 8, 10 + Math.max(0, -swing), 1, 1, skin);
      }
      const legA = f < 4 ? [0, 1, 0, -1][f] : 0;
      px(ctx, 3, 11, 2, 4 - Math.max(0, legA), pants);
      px(ctx, 5, 11, 2, 4 - Math.max(0, -legA), pants);
      px(ctx, 2 + (legA > 0 ? 1 : 0), 15 - Math.max(0, legA), 3, 1, shoe);
      px(ctx, 5, 15 - Math.max(0, -legA), 3, 1, shoe);
    });
  }

  coin(frame: number): HTMLCanvasElement {
    const f = ((frame % 4) + 4) % 4;
    return this.make(`coin:${f}`, 7, 7, (ctx) => {
      const widths = [7, 5, 2, 5];
      const w = widths[f];
      const x0 = Math.floor((7 - w) / 2);
      const rows = [[2, 3], [1, 5], [0, 7], [0, 7], [0, 7], [1, 5], [2, 3]];
      rows.forEach(([off, len], y) => {
        const scaledOff = Math.round((off / 7) * w);
        const scaledLen = Math.max(1, Math.round((len / 7) * w));
        px(ctx, x0 + scaledOff, y, scaledLen, 1, y === 0 || y === 6 ? '#a16207' : '#facc15');
      });
      if (w >= 5) {
        px(ctx, x0 + 1, 2, 1, 2, '#fef9c3');
        px(ctx, x0 + Math.floor(w / 2), 2, 1, 3, '#a16207');
      }
    });
  }

  dataBlock(): HTMLCanvasElement {
    return this.make('block', 6, 6, (ctx) => {
      px(ctx, 1, 0, 4, 1, '#a5f3fc');
      px(ctx, 0, 1, 6, 1, '#67e8f9');
      px(ctx, 0, 2, 3, 4, '#0891b2');
      px(ctx, 3, 2, 3, 4, '#0e7490');
      px(ctx, 1, 3, 1, 1, '#ecfeff');
    });
  }

  // ── Electrical inspector (darknet raid): navy uniform, peaked cap, clipboard ──
  inspector(frame: number, checking: boolean): HTMLCanvasElement {
    const f = checking ? 4 + (frame % 2) : ((frame % 4) + 4) % 4;
    return this.make(`inspector:${f}`, 11, 17, (ctx) => {
      const skin = '#e8b48a';
      const navy = '#1e3a8a';
      const navyDark = '#172554';
      const shoe = '#0a0a0a';
      // Peaked cap with a gold badge
      px(ctx, 2, 0, 6, 2, '#111827');
      px(ctx, 2, 2, 8, 1, '#030712');
      px(ctx, 4, 0, 2, 1, '#facc15');
      px(ctx, 3, 3, 5, 3, skin);
      px(ctx, 5, 4, 3, 1, '#0b0b0f'); // shades
      px(ctx, 4, 6, 3, 1, shade(skin, -0.2));
      // Uniform with hi-vis stripe
      px(ctx, 2, 7, 7, 5, navy);
      px(ctx, 2, 7, 7, 1, shade(navy, 0.25));
      px(ctx, 2, 10, 7, 1, '#facc15');
      px(ctx, 6, 8, 1, 1, '#facc15');
      const swing = f < 4 ? [0, 1, 0, -1][f] : 0;
      if (f >= 4) {
        // Clipboard held up, pen scribbling
        px(ctx, 7, 7, 4, 5, '#92400e');
        px(ctx, 8, 8, 2, 3, '#f8fafc');
        px(ctx, 8, f === 4 ? 9 : 10, 2, 1, '#64748b');
        px(ctx, 8, 6, 2, 1, '#9ca3af');
        px(ctx, 1, 8, 1, 3, navy);
        px(ctx, 1, 11, 1, 1, skin);
      } else {
        px(ctx, 1, 8 + Math.max(0, swing), 1, 3, navy);
        px(ctx, 1, 11 + Math.max(0, swing), 1, 1, skin);
        // Clipboard under the arm
        px(ctx, 8, 8, 3, 4, '#92400e');
        px(ctx, 9, 9, 1, 2, '#f8fafc');
      }
      const leg = f < 4 ? [0, 1, 0, -1][f] : 0;
      px(ctx, 3, 12, 2, 4 - Math.max(0, leg), navyDark);
      px(ctx, 6, 12, 2, 4 - Math.max(0, -leg), navyDark);
      px(ctx, 2 + (leg > 0 ? 1 : 0), 16 - Math.max(0, leg), 3, 1, shoe);
      px(ctx, 6, 16 - Math.max(0, -leg), 3, 1, shoe);
    });
  }

  /** Welder in a dark mask and orange overalls, torch towards -x. */
  welder(frame: number): HTMLCanvasElement {
    const f = ((frame % 2) + 2) % 2;
    return this.make(`welder:${f}`, 12, 16, (ctx) => {
      const suit = '#ea580c';
      px(ctx, 3, 0, 6, 5, '#27272a');
      px(ctx, 3, 0, 6, 1, '#3f3f46');
      px(ctx, 3, 2, 3, 2, f ? '#22d3ee' : '#0e7490'); // visor glint
      px(ctx, 3, 5, 7, 6, suit);
      px(ctx, 3, 5, 7, 1, shade(suit, 0.25));
      px(ctx, 5, 6, 3, 4, '#9a3412');
      // Arm + torch
      px(ctx, 1, 5 + f, 3, 1, suit);
      px(ctx, 0, 4 + f, 1, 2, '#a1a1aa');
      px(ctx, 9, 6, 1, 4, suit);
      px(ctx, 4, 11, 2, 4, '#1f2937');
      px(ctx, 7, 11, 2, 4, '#1f2937');
      px(ctx, 3, 15, 3, 1, '#0a0a0a');
      px(ctx, 7, 15, 3, 1, '#0a0a0a');
    });
  }

  /** Warehouse forklift carrying a crate (faces +x). */
  forklift(frame: number): HTMLCanvasElement {
    const f = ((frame % 2) + 2) % 2;
    return this.make(`forklift:${f}`, 34, 22, (ctx) => {
      const body = '#f59e0b';
      // Mast + forks
      px(ctx, 25, 1, 2, 19, '#3f3f46');
      px(ctx, 27, 18, 7, 2, '#52525b');
      // Crate on the forks
      px(ctx, 27, 7, 7, 11, '#92400e');
      px(ctx, 28, 8, 5, 9, '#b45309');
      px(ctx, 28, 12, 5, 1, '#78350f');
      // Cab cage
      px(ctx, 7, 2, 1, 9, '#27272a');
      px(ctx, 19, 2, 1, 9, '#27272a');
      px(ctx, 7, 2, 13, 1, '#27272a');
      // Driver
      px(ctx, 12, 4, 4, 3, '#f2c18f');
      px(ctx, 12, 3, 4, 1, '#facc15');
      px(ctx, 11, 7, 6, 4, '#2563eb');
      // Chassis
      px(ctx, 2, 10, 23, 7, body);
      px(ctx, 2, 10, 23, 1, shade(body, 0.35));
      px(ctx, 2, 16, 23, 1, shade(body, -0.35));
      px(ctx, 0, 11, 4, 5, '#3f3f46'); // counterweight
      for (let x = 4; x < 24; x += 4) px(ctx, x, 13, 2, 1, '#111827');
      // Wheels with a turning hub
      [[4, 15], [18, 15]].forEach(([wx, wy]) => {
        px(ctx, wx, wy, 6, 6, '#0a0a0a');
        px(ctx, wx + 1, wy + 1, 4, 4, '#27272a');
        px(ctx, wx + (f ? 1 : 3), wy + (f ? 1 : 3), 2, 2, '#a1a1aa');
      });
    });
  }

  /** Status icons drawn above racks (9×9, 1-px dark outline). */
  statusIcon(kind: StatusIconKind, frame: number): HTMLCanvasElement {
    const frames = kind === 'reboot' ? 8 : kind === 'overheat' ? 2 : 1;
    const f = ((frame % frames) + frames) % frames;
    return this.make(`status:${kind}:${f}`, 9, 9, (ctx) => {
      const ol = '#0a0a0a';
      const rows = (shape: string[], colors: Record<string, string>) =>
        shape.forEach((row, y) => [...row].forEach((ch, x) => colors[ch] && px(ctx, x, y, 1, 1, colors[ch])));
      if (kind === 'overheat') {
        rows(
          f === 0
            ? ['...o.....', '..oro....', '..orro.o.', '.orrrooro', '.orryrrro', 'orryyyrro', 'orryWyyro', '.oryWWyo.', '..ooooo..']
            : ['....o....', '...oro...', '.o.orro..', 'oro.orro.', 'orrrryro.', 'orryyyrro', 'oryyWyyro', '.oryWWro.', '..ooooo..'],
          { o: ol, r: '#ef4444', y: '#facc15', W: '#fef9c3' },
        );
      } else if (kind === 'overload') {
        rows(
          ['....ooooo', '...oyyyo.', '..oyyyo..', '.oyyyoooo', 'oyyyyyyyo', 'oooooyyo.', '...oyyo..', '..oyyo...', '..ooo....'],
          { o: ol, y: '#fde047' },
        );
      } else if (kind === 'no_psu') {
        rows(
          ['.o.o.....', '.g.g.....', 'ogggo....', 'ogggo..rr', '.ogo..rr.', '..c..rr..', '..c.rr...', '..crr....', '...c.....'],
          { o: ol, g: '#cbd5e1', c: '#71717a', r: '#ef4444' },
        );
      } else if (kind === 'empty') {
        // Dashed empty slot with a plus: "mount something here"
        rows(
          ['oo.ooo.oo', 'o.......o', '....c....', 'o...c...o', 'o.ccccc.o', 'o...c...o', '....c....', 'o.......o', 'oo.ooo.oo'],
          { o: '#8f89c4', c: '#e9e6ff' },
        );
      } else if (kind === 'blackout') {
        // Unplugged bulb with a strike through it
        rows(
          ['..ooooo.r', '.oggggor.', 'ogggggro.', 'oggggrgo.', 'ogggrggo.', '.ogrggo..', '..roco...', '.r.oco...', 'r..ooo...'],
          { o: ol, g: '#64748b', c: '#94a3b8', r: '#ef4444' },
        );
      } else if (kind === 'condensation') {
        // Water drop
        rows(
          ['....o....', '...obo...', '...obo...', '..obbbo..', '.obbbbbo.', '.obWbbbo.', '.obWbbbo.', '..obbbo..', '...ooo...'],
          { o: ol, b: '#38bdf8', W: '#e0f2fe' },
        );
      } else if (kind === 'throttle') {
        // Thermometer
        rows(
          ['...ooo...', '...oWo...', '...oro...', '...oro...', '...oro...', '..orrro..', '.orrrrro.', '..orrro..', '...ooo...'],
          { o: ol, r: '#f97316', W: '#f8fafc' },
        );
      } else {
        // 8-dot spinner, bright head rotating
        const dots = [[4, 0], [7, 1], [8, 4], [7, 7], [4, 8], [1, 7], [0, 4], [1, 1]];
        dots.forEach(([dx, dy], k) => {
          const age = (k - f + 8) % 8;
          const c = age === 0 ? '#ffffff' : age === 7 ? '#93c5fd' : age === 6 ? '#3b82f6' : '#64748b';
          px(ctx, dx, dy, 1, 1, c);
          if (age === 0) px(ctx, dx + (dx < 4 ? 1 : dx > 4 ? -1 : 0), dy + (dy < 4 ? 1 : dy > 4 ? -1 : 0), 1, 1, '#bfdbfe');
        });
        px(ctx, 4, 4, 1, 1, '#93c5fd');
      }
    });
  }

  /** Soft pixel glow: solid core, checker-dithered halo (no gradients). */
  glow(r: number, color: string): HTMLCanvasElement {
    const d = r * 2 + 1;
    return this.make(`glow:${r}:${color}`, d, d, (ctx) => {
      for (let y = 0; y < d; y += 1) for (let x = 0; x < d; x += 1) {
        const dist = Math.hypot(x - r, y - r);
        if (dist > r) continue;
        if (dist <= r * 0.45 || (dist <= r * 0.75 && (x + y) % 2 === 0) || (x % 2 === 0 && y % 2 === 0)) px(ctx, x, y, 1, 1, color);
      }
    });
  }

  /** Diagonal caution tape stuck across an inspected rack. */
  cautionTape(): HTMLCanvasElement {
    return this.make('caution-tape', RACK_W, RACK_H, (ctx) => {
      for (let i = 0; i < RACK_W; i += 1) {
        const y = 14 + Math.round(i * 0.9);
        const c = Math.floor(i / 3) % 2 ? '#111827' : '#facc15';
        px(ctx, i, y, 1, 5, c);
        px(ctx, i, y + 5, 1, 1, 'rgba(0,0,0,0.45)');
      }
      px(ctx, 12, 27, 17, 8, '#f8fafc');
      px(ctx, 12, 27, 17, 1, '#ef4444');
      px(ctx, 12, 34, 17, 1, '#94a3b8');
      drawPixelText(ctx, 'VOID', 13, 29, '#b91c1c');
    });
  }

  /** Full-width black/yellow hazard strip for raid banners. */
  hazardStrip(w: number): HTMLCanvasElement {
    return this.make(`hazard:${w}`, w, 9, (ctx) => {
      px(ctx, 0, 0, w, 9, '#facc15');
      for (let x = -9; x < w; x += 8) for (let y = 1; y < 8; y += 1) px(ctx, x + y, y, 4, 1, '#111827');
      px(ctx, 0, 0, w, 1, '#713f12');
      px(ctx, 0, 8, w, 1, '#713f12');
    });
  }

  /** "BLOCK FOUND!" ribbon banner. */
  blockBanner(): HTMLCanvasElement {
    return this.make('banner:block', 176, 34, (ctx) => {
      const W = 176;
      // Folded ribbon tails
      [0, W - 14].forEach((x0) => {
        px(ctx, x0, 10, 14, 19, '#a16207');
        px(ctx, x0, 10, 14, 1, '#ca8a04');
        px(ctx, x0, 28, 14, 1, '#713f12');
      });
      px(ctx, 8, 28, 4, 2, '#713f12');
      px(ctx, W - 12, 28, 4, 2, '#713f12');
      for (let k = -4; k <= 4; k += 1) {
        const d = 5 - Math.abs(k);
        ctx.clearRect(0, 19 + k, d, 1);
        ctx.clearRect(W - d, 19 + k, d, 1);
      }
      px(ctx, 8, 2, W - 16, 26, '#07060f');
      px(ctx, 9, 3, W - 18, 24, '#facc15');
      px(ctx, 10, 4, W - 20, 22, '#1e1b4b');
      px(ctx, 10, 4, W - 20, 2, '#312e81');
      px(ctx, 10, 24, W - 20, 2, '#0f0d2e');
      for (let x = 12; x < W - 12; x += 6) {
        px(ctx, x, 3, 2, 1, '#fef9c3');
        px(ctx, x + 3, 26, 2, 1, '#a16207');
      }
      drawPixelText(ctx, 'BLOCK FOUND!', W / 2 + 1, 9, '#07060f', { align: 'center', scale: 3 });
      drawPixelText(ctx, 'BLOCK FOUND!', W / 2, 8, '#a5f3fc', { align: 'center', scale: 3 });
      // Two-tone lettering: darker lower half
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 16, W, 8);
      ctx.clip();
      drawPixelText(ctx, 'BLOCK FOUND!', W / 2, 8, '#22d3ee', { align: 'center', scale: 3 });
      ctx.restore();
      px(ctx, 8, 30, W - 16, 2, 'rgba(0,0,0,0.35)');
    });
  }

  /** Aurora curtains for the arctic window: cached loop, clipped to the sky above the peaks. */
  aurora(frame: number): HTMLCanvasElement {
    const FRAMES = 32;
    const f = ((frame % FRAMES) + FRAMES) % FRAMES;
    return this.make(`aurora:${f}`, 174, 40, (ctx) => {
      const ph = (f / FRAMES) * Math.PI * 2;
      for (let i = 0; i < 174; i += 1) {
        const peakTop = 38 - Math.abs(Math.sin(i / 18) * 18) - Math.abs(Math.sin(i / 7) * 5); // matches drawRoom
        const clipY = Math.floor(peakTop) - 1;
        const glow = Math.sin(i / 17 + ph) + 0.5 * Math.sin(i / 7 - ph * 2);
        const taper = Math.min(1, Math.max(0, (glow + 0.7) / 1.1));
        if (taper <= 0.15) continue;
        // Lower (brightest) edge of the curtain, rays shooting up from it
        const base = Math.round(16 + 6 * Math.sin(i / 29 + ph) + 3 * Math.sin(i / 11 - ph * 2));
        const ray = 0.5 + 0.5 * Math.sin(i * 1.7 + ph * (1 + Math.floor(hash01('aur', i) * 3)) + hash01('aurp', i) * 6);
        const len = Math.round((5 + ray * 9 + Math.max(0, glow) * 3) * taper);
        for (let k = 0; k < len; k += 1) {
          const y = base - k;
          if (y < 0) break;
          if (y > clipY) continue;
          const fade = k / len;
          if (fade > 0.55 && (i + y) % 2 === 0) continue;
          if (fade > 0.8 && (i + y) % 3 !== 0) continue;
          const c = k === 0 ? '#d1fae5' : k < 3 ? (glow > 0.3 ? '#6ee7b7' : '#34d399') : fade < 0.55 ? '#10b981' : fade < 0.8 ? '#0d9488' : '#8b5cf6';
          px(ctx, i, y, 1, 1, c);
        }
      }
    });
  }

  // ── Room backgrounds (480×270) ──
  roomBackground(roomId: RoomId, w: number, h: number, wallH: number): HTMLCanvasElement {
    return this.make(`room:${roomId}:${w}x${h}`, w, h, (ctx) => drawRoom(ctx, roomId, w, h, wallH));
  }

  // ── Data-URL icons for the HTML UI ──
  gpuIcon(modelId: string): string {
    return this.url(`icon:gpu:${modelId}`, () => {
      const model = GPU_BY_ID[modelId];
      const w = 48;
      const h = model.style === 'card' ? 18 : 20;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d') as Ctx;
      this.drawGpu(ctx, model, 0, 0, w, h, 0.37, { running: true, load: 0.5, temp: 50, shutdown: false, throttled: false });
      return c;
    });
  }

  coolerIcon(modelId: string): string {
    return this.url(`icon:cool:${modelId}`, () => this.cooler(COOLER_BY_ID[modelId], 18, 18, 1));
  }

  psuIcon(modelId: string): string {
    return this.url(`icon:psu:${modelId}`, () => this.psu(PSU_BY_ID[modelId], 28, 10));
  }

  rackIcon(modelId: string): string {
    const model = RACK_BY_ID[modelId];
    return this.url(`icon:rack:${modelId}`, () => this.rackBody(model.style, model.slots, model.fanSlots));
  }

  /** 14x14 token for a coin: round disc in the coin's color with its emblem (C, B, star, M). */
  coinIcon(coin: CoinId): string {
    return this.url(`icon:coin:${coin}`, () => this.make(`coinicon:${coin}`, 14, 14, (ctx) => {
      const color = COIN_INFO[coin].color;
      const rim = shade(color, -0.5);
      const face = color;
      const ink = shade(color, -0.72);
      const c = 6.5;
      for (let y = 0; y < 14; y += 1) {
        for (let x = 0; x < 14; x += 1) {
          const d = Math.hypot(x - c, y - c);
          if (d <= 6.6) px(ctx, x, y, 1, 1, d > 5.3 ? rim : face);
        }
      }
      // Shine on the upper-left edge and a darker lower-right edge.
      px(ctx, 3, 2, 2, 1, shade(color, 0.65));
      px(ctx, 2, 3, 1, 2, shade(color, 0.65));
      px(ctx, 10, 11, 2, 1, shade(color, -0.3));
      const glyph = COIN_GLYPHS[coin];
      const gw = glyph[0].length;
      const x0 = Math.floor((14 - gw) / 2);
      const y0 = Math.floor((14 - glyph.length) / 2);
      glyph.forEach((row, gy) => {
        for (let gx = 0; gx < gw; gx += 1) if (row[gx] === '#') px(ctx, x0 + gx, y0 + gy, 1, 1, ink);
      });
    }));
  }

  roomIcon(roomId: RoomId): string {
    return this.url(`icon:room:${roomId}`, () => {
      const full = this.roomBackground(roomId, 480, 270, 80);
      const c = document.createElement('canvas');
      c.width = 120;
      c.height = 68;
      const ctx = c.getContext('2d') as Ctx;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(full, 0, 0, 480, 270, 0, 0, 120, 68);
      return c;
    });
  }
}

const COIN_GLYPHS: Record<CoinId, string[]> = {
  CC: ['.###.', '#...#', '#....', '#....', '#...#', '.###.'],
  BYT: ['####.', '#...#', '####.', '#...#', '#...#', '####.'],
  NOVA: ['..#..', '..#..', '#####', '.###.', '.#.#.', '#...#'],
  MEME: ['#...#', '##.##', '#.#.#', '#...#', '#...#', '#...#'],
};

// ───────────────────────── Room painters ─────────────────────────

function drawRoom(ctx: Ctx, roomId: RoomId, W: number, H: number, wallH: number): void {
  const t = ROOM_BY_ID[roomId].theme;
  // Wall
  px(ctx, 0, 0, W, wallH, t.wall);
  px(ctx, 0, wallH - 6, W, 6, t.trim);
  px(ctx, 0, wallH - 6, W, 1, shade(t.trim, 0.3));
  px(ctx, 0, wallH - 1, W, 1, shade(t.trim, -0.4));
  // Floor
  px(ctx, 0, wallH, W, H - wallH, t.floorA);
  const seed = roomId;

  switch (roomId) {
    case 'bedroom': {
      for (let x = 0; x < W; x += 12) px(ctx, x, 0, 5, wallH - 6, t.wallDark);
      for (let y = wallH; y < H; y += 8) {
        const off = ((y - wallH) / 8) % 2 === 0 ? 0 : 24;
        px(ctx, 0, y, W, 1, shade(t.floorA, -0.25));
        for (let x = off; x < W; x += 48) px(ctx, x, y, 1, 8, shade(t.floorA, -0.25));
        for (let x = off + 10; x < W; x += 48) px(ctx, x, y + 3, 6, 1, t.floorB);
      }
      // Window with night sky
      px(ctx, 300, 12, 70, 50, '#e7d7c1');
      px(ctx, 303, 15, 64, 44, '#0b1026');
      px(ctx, 303, 37, 64, 22, '#1e1b4b');
      px(ctx, 334, 15, 2, 44, '#e7d7c1');
      px(ctx, 303, 36, 64, 2, '#e7d7c1');
      for (let i = 0; i < 6; i += 1) px(ctx, 296 + i, 10, 1, 56, '#9d174d');
      for (let i = 0; i < 6; i += 1) px(ctx, 368 + i, 10, 1, 56, '#9d174d');
      px(ctx, 295, 9, 81, 2, '#52525b');
      // Poster
      px(ctx, 60, 14, 44, 52, '#facc15');
      px(ctx, 62, 16, 40, 48, '#111827');
      drawPixelText(ctx, 'HODL', 82, 22, '#facc15', { align: 'center' });
      for (let i = 0; i < 18; i += 1) px(ctx, 66 + i * 2, 54 - Math.round(Math.sin(i / 2) * 6 + i * 1.2), 2, 2, '#22c55e');
      // Bed
      px(ctx, 6, 186, 96, 74, '#3f3f46');
      px(ctx, 8, 188, 92, 70, '#1d4ed8');
      px(ctx, 8, 188, 92, 4, '#3b82f6');
      px(ctx, 12, 192, 34, 18, '#f8fafc');
      px(ctx, 12, 208, 34, 2, '#cbd5e1');
      for (let y = 214; y < 256; y += 8) px(ctx, 8, y, 92, 1, '#1e40af');
      // Rug
      px(ctx, 160, 222, 160, 36, '#7c2d12');
      px(ctx, 164, 226, 152, 28, '#b45309');
      for (let x = 168; x < 312; x += 8) px(ctx, x, 238, 4, 4, '#fde68a');
      // Desk + CRT monitor
      px(ctx, 388, 150, 84, 6, '#78350f');
      px(ctx, 392, 156, 4, 40, '#451a03');
      px(ctx, 464, 156, 4, 40, '#451a03');
      px(ctx, 404, 116, 44, 34, '#d6d3d1');
      px(ctx, 408, 120, 36, 24, '#052e16');
      px(ctx, 420, 146, 12, 4, '#a8a29e');
      break;
    }
    case 'garage': {
      for (let y = 0; y < wallH - 6; y += 10) px(ctx, 0, y, W, 1, t.wallDark);
      for (let y = 0; y < wallH - 6; y += 10) for (let x = (y / 10) % 2 ? 0 : 20; x < W; x += 40) px(ctx, x, y, 1, 10, t.wallDark);
      // Roll-up door
      px(ctx, 18, 6, 160, wallH - 12, '#71717a');
      for (let y = 8; y < wallH - 6; y += 5) {
        px(ctx, 20, y, 156, 1, '#a1a1aa');
        px(ctx, 20, y + 3, 156, 1, '#52525b');
      }
      px(ctx, 92, wallH - 12, 12, 3, '#27272a');
      // Pegboard with tools
      px(ctx, 340, 10, 110, 52, '#a16207');
      for (let y = 14; y < 60; y += 6) for (let x = 344; x < 448; x += 6) px(ctx, x, y, 1, 1, '#713f12');
      px(ctx, 350, 18, 3, 26, '#ef4444');
      px(ctx, 347, 16, 9, 4, '#9ca3af');
      px(ctx, 366, 20, 18, 3, '#9ca3af');
      px(ctx, 366, 23, 4, 16, '#1f2937');
      px(ctx, 396, 16, 10, 10, '#22c55e');
      px(ctx, 399, 19, 4, 4, '#a16207');
      px(ctx, 418, 18, 20, 2, '#d4d4d8');
      px(ctx, 418, 30, 24, 2, '#d4d4d8');
      // Hazard stripes on the trim
      for (let x = 0; x < W; x += 12) px(ctx, x, wallH - 6, 6, 6, '#111827');
      // Concrete floor
      for (let i = 0; i < 260; i += 1) px(ctx, Math.floor(hash01(seed, i) * W), wallH + Math.floor(hash01(seed, i + 999) * (H - wallH)), 1, 1, shade(t.floorA, hash01(seed, i + 7) > 0.5 ? 0.08 : -0.12));
      for (let x = 0; x < W; x += 80) px(ctx, x, wallH, 1, H - wallH, shade(t.floorA, -0.2));
      px(ctx, 0, wallH + 95, W, 1, shade(t.floorA, -0.2));
      // Oil stain & tires
      px(ctx, 40, 226, 46, 16, '#1c1917');
      px(ctx, 34, 230, 58, 8, '#1c1917');
      px(ctx, 48, 230, 8, 3, '#44403c');
      [0, 14, 28].forEach((dy) => {
        px(ctx, 420, 210 - dy, 40, 14, '#111827');
        px(ctx, 424, 213 - dy, 32, 8, '#27272a');
        px(ctx, 432, 215 - dy, 16, 4, '#0a0a0a');
      });
      // Welding corner: gas bottle, welder unit, low workbench with a clamped bar (welder drawn live)
      px(ctx, 8, 114, 7, 28, '#15803d');
      px(ctx, 9, 114, 2, 28, '#22c55e');
      px(ctx, 9, 111, 5, 3, '#3f3f46');
      px(ctx, 10, 109, 3, 2, '#a1a1aa');
      px(ctx, 17, 130, 14, 12, '#1e40af');
      px(ctx, 17, 130, 14, 1, '#3b82f6');
      px(ctx, 19, 133, 5, 3, '#0f172a');
      px(ctx, 20, 134, 2, 1, '#4ade80');
      px(ctx, 26, 133, 3, 3, '#facc15');
      px(ctx, 30, 131, 51, 3, '#78350f');
      px(ctx, 30, 131, 51, 1, '#a16207');
      px(ctx, 32, 134, 2, 8, '#451a03');
      px(ctx, 77, 134, 2, 8, '#451a03');
      px(ctx, 32, 139, 47, 1, '#451a03');
      px(ctx, 68, 125, 7, 6, '#52525b');
      px(ctx, 68, 125, 7, 1, '#71717a');
      px(ctx, 56, 128, 25, 2, '#9ca3af');
      px(ctx, 56, 128, 25, 1, '#d4d4d8');
      for (let i = 0; i < 56; i += 1) px(ctx, 30 + i, 141 - Math.round(Math.abs(Math.sin(i / 6))), 1, 1, '#111827');
      break;
    }
    case 'warehouse': {
      for (let x = 0; x < W; x += 6) px(ctx, x, 0, 3, wallH - 6, t.wallDark);
      // I-beam + high windows
      px(ctx, 0, 4, W, 6, '#b45309');
      px(ctx, 0, 4, W, 1, '#f59e0b');
      px(ctx, 0, 9, W, 1, '#78350f');
      for (let x = 30; x < W; x += 110) {
        px(ctx, x, 18, 64, 26, '#94a3b8');
        px(ctx, x + 2, 20, 60, 22, '#bae6fd');
        px(ctx, x + 31, 20, 2, 22, '#94a3b8');
        px(ctx, x + 2, 30, 60, 1, '#94a3b8');
        px(ctx, x + 6, 22, 10, 2, '#f0f9ff');
      }
      // Floor plates + safety lines
      for (let y = wallH; y < H; y += 32) px(ctx, 0, y, W, 1, shade(t.floorA, -0.25));
      for (let x = 0; x < W; x += 48) px(ctx, x, wallH, 1, H - wallH, shade(t.floorA, -0.25));
      px(ctx, 0, wallH + 8, W, 3, '#facc15');
      px(ctx, 0, H - 8, W, 3, '#facc15');
      for (let x = 0; x < W; x += 16) px(ctx, x, H - 8, 8, 3, '#111827');
      // Pallets & crates
      const crate = (x: number, y: number, s: number) => {
        px(ctx, x, y, s, s, '#92400e');
        px(ctx, x + 1, y + 1, s - 2, s - 2, '#b45309');
        px(ctx, x + 1, y + Math.floor(s / 2), s - 2, 1, '#78350f');
        px(ctx, x + Math.floor(s / 2), y + 1, 1, s - 2, '#78350f');
      };
      crate(6, 200, 26);
      crate(34, 210, 18);
      crate(12, 176, 22);
      crate(440, 206, 28);
      crate(446, 182, 22);
      break;
    }
    case 'arctic': {
      for (let x = 0; x < W; x += 40) px(ctx, x, 0, 1, wallH - 6, t.wallDark);
      for (let y = 20; y < wallH - 6; y += 20) px(ctx, 0, y, W, 1, t.wallDark);
      // Panoramic window with snowy mountains
      px(ctx, 150, 8, 180, 58, '#64748b');
      px(ctx, 153, 11, 174, 52, '#1e3a8a');
      px(ctx, 153, 37, 174, 26, '#334155');
      for (let i = 0; i < 174; i += 1) {
        const peak = 38 - Math.abs(Math.sin(i / 18) * 18) - Math.abs(Math.sin(i / 7) * 5);
        px(ctx, 153 + i, 11 + peak, 1, 52 - peak, '#e2e8f0');
        px(ctx, 153 + i, 11 + peak, 1, 3, '#ffffff');
      }
      px(ctx, 239, 11, 2, 52, '#64748b');
      // LED strip trim
      for (let x = 0; x < W; x += 4) px(ctx, x, wallH - 4, 2, 1, '#38bdf8');
      // Raised floor tiles
      for (let y = wallH; y < H; y += 20) px(ctx, 0, y, W, 1, t.floorB);
      for (let x = 0; x < W; x += 30) px(ctx, x, wallH, 1, H - wallH, t.floorB);
      for (let y = wallH + 10; y < H; y += 40) for (let x = 15; x < W; x += 60) {
        for (let k = 0; k < 4; k += 1) px(ctx, x + k * 2 - 4, y - 2, 1, 1, '#94a3b8');
        for (let k = 0; k < 4; k += 1) px(ctx, x + k * 2 - 4, y + 1, 1, 1, '#94a3b8');
      }
      // Cooling ducts
      px(ctx, 10, 30, 40, 36, '#94a3b8');
      for (let y = 33; y < 64; y += 3) px(ctx, 13, y, 34, 1, '#475569');
      px(ctx, 430, 30, 40, 36, '#94a3b8');
      for (let y = 33; y < 64; y += 3) px(ctx, 433, y, 34, 1, '#475569');
      break;
    }
    case 'submarine': {
      // Riveted hull plates
      for (let x = 0; x < W; x += 48) px(ctx, x, 0, 1, wallH - 6, t.wallDark);
      for (let y = 0; y < wallH - 6; y += 24) px(ctx, 0, y, W, 1, t.wallDark);
      for (let x = 4; x < W; x += 8) for (let y = 4; y < wallH - 8; y += 24) px(ctx, x, y, 1, 1, shade(t.wall, 0.35));
      // Pipes
      px(ctx, 0, 2, W, 4, '#64748b');
      px(ctx, 0, 2, W, 1, '#94a3b8');
      for (let x = 60; x < W; x += 120) {
        px(ctx, x, 0, 8, 8, '#475569');
        px(ctx, x + 2, 1, 4, 2, '#ef4444');
      }
      // Portholes (water drawn live on top)
      [96, 240, 384].forEach((cx) => {
        for (let y = -20; y <= 20; y += 1) for (let x = -20; x <= 20; x += 1) {
          const r = Math.hypot(x, y);
          if (r <= 20) px(ctx, cx + x, 40 + y, 1, 1, r > 16 ? '#facc15' : r > 14 ? '#a16207' : '#0c4a6e');
        }
        [[0, -18], [0, 18], [-18, 0], [18, 0]].forEach(([dx, dy]) => px(ctx, cx + dx, 40 + dy, 1, 1, '#713f12'));
      });
      // Sonar console (sweep drawn live)
      px(ctx, 424, 18, 44, 48, '#334155');
      px(ctx, 424, 18, 44, 1, '#64748b');
      px(ctx, 425, 65, 43, 1, '#0f172a');
      for (let y = -15; y <= 15; y += 1) for (let x = -15; x <= 15; x += 1) {
        const r = Math.hypot(x, y);
        if (r <= 15) px(ctx, 446 + x, 39 + y, 1, 1, r > 13.5 ? '#94a3b8' : r > 12.5 ? '#0f172a' : '#022c22');
      }
      for (let a = 0; a < 48; a += 1) {
        const ang = (a / 48) * Math.PI * 2;
        px(ctx, 446 + Math.cos(ang) * 8, 39 + Math.sin(ang) * 8, 1, 1, '#065f46');
      }
      px(ctx, 434, 39, 24, 1, '#064e3b');
      px(ctx, 446, 27, 1, 24, '#064e3b');
      drawPixelText(ctx, 'SONAR', 446, 57, '#5eead4', { align: 'center' });
      // Grated floor
      for (let y = wallH; y < H; y += 6) px(ctx, 0, y, W, 1, t.floorB);
      for (let x = 0; x < W; x += 6) px(ctx, x, wallH, 1, H - wallH, shade(t.floorA, -0.15));
      px(ctx, 0, wallH + 4, W, 2, '#facc15');
      break;
    }
    default:
      break;
  }
  // Soft vignette at floor edges for depth
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(0, wallH, W, 6);
}

export const sprites = new SpriteManager();
