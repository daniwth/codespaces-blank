import { useEffect, useRef, useState } from 'react';
import { drawPixelText, px } from '../../engine/SpriteManager';
import { useGameStore } from '../../store/useGameStore';
import type { Candle, CoinId } from '../../types/economy';
import { formatPrice } from '../../utils/formatters';

interface Props {
  coin: CoinId;
  height?: number;
}

const PIXEL = 2; // CSS pixels per chart pixel (chunky retro look)

const fmtAxis = (v: number) => (v >= 10 ? v.toFixed(1) : v >= 1 ? v.toFixed(3) : v >= 0.01 ? v.toFixed(4) : v.toFixed(5));

/**
 * Native Canvas 2D candlestick chart rendered at half resolution and
 * upscaled with nearest-neighbour filtering inside a CRT bezel.
 */
export function CryptoCanvasChart({ coin, height = 200 }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hoverX = useRef<number | null>(null);
  const [hover, setHover] = useState<Candle | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    let raf = 0;
    let last = 0;
    let W = 0;
    let H = 0;
    const resize = () => {
      W = Math.max(80, Math.floor(wrap.clientWidth / PIXEL));
      H = Math.max(60, Math.floor(height / PIXEL));
      canvas.width = W;
      canvas.height = H;
      canvas.style.width = `${W * PIXEL}px`;
      canvas.style.height = `${H * PIXEL}px`;
      ctx.imageSmoothingEnabled = false;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 60) return;
      last = now;
      const market = useGameStore.getState().market[coin];
      const candles = [...market.candles, market.current];
      const axisW = 34;
      const plotW = W - axisW - 2;
      const plotH = H - 12;
      const cw = 4;
      const visible = candles.slice(-Math.floor(plotW / cw));
      const lo = Math.min(...visible.map((c) => c.l)) * 0.995;
      const hi = Math.max(...visible.map((c) => c.h)) * 1.005;
      const yOf = (v: number) => 2 + (1 - (v - lo) / Math.max(1e-12, hi - lo)) * (plotH - 4);

      px(ctx, 0, 0, W, H, '#020a06');
      // Grid
      for (let gy = 0; gy <= 4; gy += 1) {
        const y = Math.round(2 + (gy / 4) * (plotH - 4));
        for (let x = 0; x < plotW; x += 3) px(ctx, x, y, 1, 1, '#0b3d1f');
        drawPixelText(ctx, fmtAxis(hi - (gy / 4) * (hi - lo)), W - 2, y - 2, '#22c55e', { align: 'right' });
      }
      for (let x = plotW; x >= 0; x -= cw * 6) for (let y = 2; y < plotH; y += 3) px(ctx, x, y, 1, 1, '#0b3d1f');
      // Base price reference
      const by = yOf(market.basePrice);
      if (by > 2 && by < plotH) for (let x = 0; x < plotW; x += 2) px(ctx, x, by, 1, 1, '#1e3a8a');

      // Candles
      visible.forEach((c, i) => {
        const x = plotW - (visible.length - i) * cw;
        const up = c.c >= c.o;
        const col = up ? '#4ade80' : '#f87171';
        const top = yOf(Math.max(c.o, c.c));
        const bot = yOf(Math.min(c.o, c.c));
        px(ctx, x + 1, yOf(c.h), 1, Math.max(1, yOf(c.l) - yOf(c.h)), up ? '#166534' : '#7f1d1d');
        px(ctx, x, top, 3, Math.max(1, bot - top), col);
      });

      // Live price line + tag
      const py = yOf(market.price);
      for (let x = 0; x < plotW; x += 4) px(ctx, x, py, 2, 1, '#facc15');
      px(ctx, plotW, py - 4, axisW + 2, 9, '#facc15');
      drawPixelText(ctx, fmtAxis(market.price), W - 2, py - 2, '#020a06', { align: 'right' });

      // Sweep beam
      const sweep = (now / 25) % plotW;
      ctx.globalAlpha = 0.12;
      px(ctx, sweep, 0, 2, plotH, '#4ade80');
      ctx.globalAlpha = 1;

      // Hover crosshair
      if (hoverX.current !== null) {
        const hx = Math.floor(hoverX.current / PIXEL);
        const idx = visible.length - Math.ceil((plotW - hx) / cw);
        const c = visible[idx];
        if (c) {
          const cx = plotW - (visible.length - idx) * cw + 1;
          for (let y = 0; y < plotH; y += 2) px(ctx, cx, y, 1, 1, '#e9e6ff');
          setHover((prev) => (prev?.t === c.t && prev.c === c.c ? prev : c));
        }
      }

      drawPixelText(ctx, `$${coin}/USD  5S`, 2, H - 8, '#22c55e');
      const ratio = market.price / market.basePrice;
      drawPixelText(ctx, `${ratio.toFixed(2)}X BASE`, plotW - 2, H - 8, ratio >= 1 ? '#4ade80' : '#f87171', { align: 'right' });
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [coin, height]);

  return (
    <div className="bg-[#1c1917] p-2 shadow-[inset_0_0_0_2px_#44403c,inset_0_0_0_4px_#0c0a09]">
      <div ref={wrapRef} className="crt relative" style={{ height }}>
        <canvas
          ref={canvasRef}
          className="pixelated block"
          style={{ filter: 'drop-shadow(0 0 2px rgba(74,222,128,0.6))' }}
          onPointerMove={(e) => {
            hoverX.current = e.clientX - e.currentTarget.getBoundingClientRect().left;
          }}
          onPointerLeave={() => {
            hoverX.current = null;
            setHover(null);
          }}
        />
        {hover && (
          <div className="pointer-events-none absolute left-2 top-2 z-10 bg-black/80 px-2 text-[15px] leading-tight text-[#4ade80]">
            O {formatPrice(hover.o)} H {formatPrice(hover.h)} L {formatPrice(hover.l)} C {formatPrice(hover.c)}
          </div>
        )}
      </div>
    </div>
  );
}
