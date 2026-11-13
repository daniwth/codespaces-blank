/**
 * Low-resolution viewport: draws into an offscreen buffer at native pixel-art
 * resolution and presents it to the visible canvas with an integer device-pixel
 * scale (no blurry interpolation), plus a lightweight particle system.
 */
import { drawPixelText, measurePixelText, px, RACK_H, RACK_W } from './SpriteManager';

export const WORLD_W = 480;
export const WORLD_H = 270;
export const WALL_H = 80;

export type RenderFn = (ctx: CanvasRenderingContext2D, time: number, dt: number) => void;

export class PixelCanvas {
  readonly width: number;
  readonly height: number;
  readonly buffer: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  private view: HTMLCanvasElement;
  private viewCtx: CanvasRenderingContext2D;
  private raf = 0;
  private running = false;
  scale = 1;

  constructor(view: HTMLCanvasElement, width = WORLD_W, height = WORLD_H) {
    this.width = width;
    this.height = height;
    this.view = view;
    this.viewCtx = view.getContext('2d') as CanvasRenderingContext2D;
    this.buffer = document.createElement('canvas');
    this.buffer.width = width;
    this.buffer.height = height;
    this.ctx = this.buffer.getContext('2d') as CanvasRenderingContext2D;
    this.ctx.imageSmoothingEnabled = false;
  }

  /** Fit into a CSS box using the largest integer device-pixel scale. */
  resize(cssWidth: number, cssHeight: number): void {
    const dpr = window.devicePixelRatio || 1;
    const fit = Math.min((cssWidth * dpr) / this.width, (cssHeight * dpr) / this.height);
    if (fit < 1) {
      // Smaller than native resolution (tiny phones): fractional downscale.
      const cssScale = Math.min(cssWidth / this.width, cssHeight / this.height);
      this.scale = cssScale;
      this.view.width = this.width;
      this.view.height = this.height;
      this.view.style.width = `${this.width * cssScale}px`;
      this.view.style.height = `${this.height * cssScale}px`;
    } else {
      const devScale = Math.floor(fit);
      this.scale = devScale / dpr;
      this.view.width = this.width * devScale;
      this.view.height = this.height * devScale;
      this.view.style.width = `${(this.width * devScale) / dpr}px`;
      this.view.style.height = `${(this.height * devScale) / dpr}px`;
    }
    this.viewCtx.imageSmoothingEnabled = false;
  }

  start(render: RenderFn): void {
    if (this.running) return;
    this.running = true;
    const t0 = performance.now();
    let last = t0;
    const loop = (now: number) => {
      if (!this.running) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      render(this.ctx, (now - t0) / 1000, dt);
      this.present();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  present(): void {
    this.viewCtx.imageSmoothingEnabled = false;
    this.viewCtx.drawImage(this.buffer, 0, 0, this.view.width, this.view.height);
  }

  /** Convert a pointer position into world (buffer) pixel coordinates. */
  toWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.view.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * this.width,
      y: ((clientY - rect.top) / rect.height) * this.height,
    };
  }

  /** World → CSS pixel offset inside the canvas element (for HTML overlays). */
  toCss(x: number, y: number): { left: number; top: number } {
    const rect = this.view.getBoundingClientRect();
    return { left: (x / this.width) * rect.width, top: (y / this.height) * rect.height };
  }
}

// ───────────────────────── Pad layout ─────────────────────────

export interface PadSlot {
  index: number;
  x: number;
  y: number;
}

/** Rack pad positions (top-left of a 40×64 rack) for a room with `count` pads. */
export function computePadLayout(count: number): PadSlot[] {
  const rows = count <= 6 ? 1 : 2;
  const perRow = Math.ceil(count / rows);
  const spacing = Math.min(56, Math.floor(440 / perRow));
  const totalW = perRow * spacing;
  const startX = Math.floor((WORLD_W - totalW) / 2 + (spacing - RACK_W) / 2);
  const bases = rows === 1 ? [214] : [168, 250];
  return Array.from({ length: count }, (_, i) => {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const inRow = row === rows - 1 ? count - perRow * (rows - 1) : perRow;
    const rowOffset = Math.floor(((perRow - inRow) * spacing) / 2);
    return { index: i, x: startX + col * spacing + rowOffset, y: bases[row] - RACK_H };
  });
}

// ───────────────────────── Particles ─────────────────────────

export type ParticleKind = 'smoke' | 'spark' | 'coin' | 'block' | 'text' | 'sparkle' | 'snow' | 'bubble' | 'air';

export interface Particle {
  kind: ParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  text?: string;
  /** Homing target for coins / data blocks. */
  tx?: number;
  ty?: number;
}

export class ParticleSystem {
  particles: Particle[] = [];
  private max: number;

  constructor(max = 600) {
    this.max = max;
  }

  spawn(p: Omit<Particle, 'maxLife'> & { maxLife?: number }): void {
    if (this.particles.length >= this.max) this.particles.shift();
    this.particles.push({ ...p, maxLife: p.maxLife ?? p.life });
  }

  smoke(x: number, y: number): void {
    this.spawn({ kind: 'smoke', x: x + (Math.random() - 0.5) * 8, y, vx: (Math.random() - 0.5) * 6, vy: -10 - Math.random() * 8, life: 1.6 + Math.random(), size: 2, color: Math.random() < 0.5 ? '#6b7280' : '#9ca3af' });
  }

  spark(x: number, y: number): void {
    for (let i = 0; i < 3; i += 1) {
      this.spawn({ kind: 'spark', x, y, vx: (Math.random() - 0.5) * 60, vy: -20 - Math.random() * 40, life: 0.4 + Math.random() * 0.4, size: 1, color: Math.random() < 0.5 ? '#fde047' : '#f97316' });
    }
  }

  coin(x: number, y: number, tx: number, ty: number): void {
    this.spawn({ kind: 'coin', x, y, vx: (Math.random() - 0.5) * 30, vy: -40 - Math.random() * 20, life: 1.6, size: 7, color: '#facc15', tx, ty });
  }

  /** Data block that pops out and homes to (tx, ty); `power` scales the initial kick. */
  block(x: number, y: number, tx: number, ty: number, power = 1): void {
    this.spawn({ kind: 'block', x, y, vx: (Math.random() - 0.5) * 60 * power * power, vy: (-60 - Math.random() * 30) * power, life: 2, size: 6, color: '#22d3ee', tx, ty });
  }

  text(x: number, y: number, text: string, color: string): void {
    this.spawn({ kind: 'text', x, y, vx: 0, vy: -14, life: 1.4, size: 1, color, text });
  }

  sparkle(x: number, y: number, color = '#fef08a'): void {
    this.spawn({ kind: 'sparkle', x, y, vx: (Math.random() - 0.5) * 10, vy: -6 - Math.random() * 6, life: 0.6, size: 1, color });
  }

  /** Airflow streak leaving a cooler (thermal view): drifts sideways and up, then fades. */
  air(x: number, y: number, dir: 1 | -1, strength = 1): void {
    this.spawn({ kind: 'air', x, y: y + (Math.random() - 0.5) * 6, vx: dir * (14 + Math.random() * 16) * strength, vy: -3 - Math.random() * 5, life: 0.5 + Math.random() * 0.5, size: 2, color: Math.random() < 0.5 ? '#a5f3fc' : '#e0f2fe' });
  }

  update(dt: number): void {
    const next: Particle[] = [];
    for (const p of this.particles) {
      p.life -= dt;
      if (p.life <= 0) continue;
      const age = 1 - p.life / p.maxLife;
      if ((p.kind === 'coin' || p.kind === 'block') && p.tx !== undefined && p.ty !== undefined && age > 0.25) {
        // Ease towards the HUD counter.
        const k = Math.min(1, dt * (3 + age * 8));
        p.x += (p.tx - p.x) * k;
        p.y += (p.ty - p.y) * k;
        if (Math.abs(p.tx - p.x) < 2 && Math.abs(p.ty - p.y) < 2) continue;
      } else {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      if (p.kind === 'spark') p.vy += 160 * dt;
      if (p.kind === 'coin' || p.kind === 'block') p.vy += 60 * dt;
      if (p.kind === 'smoke') p.size = 2 + age * 4;
      next.push(p);
    }
    this.particles = next;
  }

  /** Renders all particles; `drawSprite` paints coin/block sprites. */
  draw(ctx: CanvasRenderingContext2D, time: number, drawSprite: (p: Particle, frame: number) => void, drawText: (p: Particle) => void): void {
    for (const p of this.particles) {
      const alpha = Math.min(1, p.life / (p.maxLife * 0.5));
      ctx.globalAlpha = p.kind === 'smoke' ? alpha * 0.55 : alpha;
      if (p.kind === 'coin' || p.kind === 'block') drawSprite(p, Math.floor(time * 10 + p.x));
      else if (p.kind === 'text') drawText(p);
      else if (p.kind === 'air') px(ctx, p.x, p.y, p.size, 1, p.color);
      else px(ctx, p.x, p.y, p.size, p.size, p.color);
    }
    ctx.globalAlpha = 1;
  }
}

// ───────────────────────── Floating text ─────────────────────────

export interface FloatingText {
  text: string;
  x: number;
  /** Current top of the label; it rises from `y0` by `rise` pixels over its life. */
  y: number;
  y0: number;
  color: string;
  age: number;
  life: number;
  scale: 1 | 2;
  rise: number;
}

export interface FloatingTextOpts {
  /** Double-size label for the big moments (a block, a BSOD). */
  big?: boolean;
  life?: number;
}

const easeOutCubic = (k: number): number => 1 - (1 - k) ** 3;

/**
 * Pixel labels that pop over a spot of the world and float up: "+1.2 $CC" on the rack that mined it,
 * "-15C" after a re-paste, "88C!" when a die starts to cook, "BSOD" on a crashed overclock.
 * Drawn with the 3×5 bitmap font. Labels spawned on top of each other are stacked, never overlapped,
 * and every label is kept inside the world horizontally.
 */
export class FloatingTextLayer {
  items: FloatingText[] = [];
  private max: number;
  private worldW: number;

  constructor(max = 48, worldW = WORLD_W) {
    this.max = max;
    this.worldW = worldW;
  }

  spawn(x: number, y: number, text: string, color: string, opts: FloatingTextOpts = {}): FloatingText {
    const scale: 1 | 2 = opts.big ? 2 : 1;
    const half = measurePixelText(text, scale) / 2;
    const cx = Math.round(Math.max(half + 2, Math.min(this.worldW - half - 2, x)));
    const lineH = 5 * scale + 2;
    // Stack above any young label that would be drawn over this one.
    let top = Math.round(y);
    let moved = true;
    while (moved) {
      moved = false;
      for (const it of this.items) {
        const itH = 5 * it.scale + 2;
        const overlapX = Math.abs(it.x - cx) < half + measurePixelText(it.text, it.scale) / 2 + 2;
        if (overlapX && top < it.y + itH && top + lineH > it.y) {
          top = it.y - lineH;
          moved = true;
        }
      }
    }
    const item: FloatingText = { text, x: cx, y: top, y0: top, color, age: 0, life: opts.life ?? (opts.big ? 2.2 : 1.6), scale, rise: opts.big ? 22 : 16 };
    if (this.items.length >= this.max) this.items.shift();
    this.items.push(item);
    return item;
  }

  update(dt: number): void {
    const next: FloatingText[] = [];
    for (const it of this.items) {
      it.age += dt;
      if (it.age >= it.life) continue;
      it.y = it.y0 - it.rise * easeOutCubic(it.age / it.life);
      next.push(it);
    }
    this.items = next;
  }

  /** Opacity of a label: quick pop-in, hold, fade over the last third. */
  static alpha(it: Pick<FloatingText, 'age' | 'life'>): number {
    const k = it.age / it.life;
    if (k < 0.06) return k / 0.06;
    return k > 0.66 ? Math.max(0, (1 - k) / 0.34) : 1;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const it of this.items) {
      ctx.globalAlpha = FloatingTextLayer.alpha(it);
      const y = Math.round(it.y);
      // 1-px dark outline so the label reads over any room.
      const s = it.scale;
      drawPixelText(ctx, it.text, it.x - s, y, '#05040c', { align: 'center', scale: s });
      drawPixelText(ctx, it.text, it.x + s, y, '#05040c', { align: 'center', scale: s });
      drawPixelText(ctx, it.text, it.x, y - s, '#05040c', { align: 'center', scale: s });
      drawPixelText(ctx, it.text, it.x, y + s, '#05040c', { align: 'center', scale: s });
      drawPixelText(ctx, it.text, it.x, y, it.color, { align: 'center', scale: s });
    }
    ctx.globalAlpha = 1;
  }
}
