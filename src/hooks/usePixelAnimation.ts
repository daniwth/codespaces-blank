import { useEffect, useRef } from 'react';

export interface PixelAnimationFrame {
  ctx: CanvasRenderingContext2D;
  /** Seconds since mount. */
  time: number;
  /** Seconds since the previous frame. */
  dt: number;
  width: number;
  height: number;
}

/**
 * Drives a small low-resolution canvas with requestAnimationFrame.
 * The canvas keeps its native pixel size and is upscaled with CSS
 * (`image-rendering: pixelated`) by an integer factor.
 */
export function usePixelAnimation(
  draw: (frame: PixelAnimationFrame) => void,
  width: number,
  height: number,
  fps = 30,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    ctx.imageSmoothingEnabled = false;
    let raf = 0;
    const start = performance.now();
    let last = start;
    const frameMs = 1000 / fps;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < frameMs - 1) return;
      const dt = (now - last) / 1000;
      last = now;
      ctx.clearRect(0, 0, width, height);
      drawRef.current({ ctx, time: (now - start) / 1000, dt, width, height });
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [width, height, fps]);

  return canvasRef;
}
