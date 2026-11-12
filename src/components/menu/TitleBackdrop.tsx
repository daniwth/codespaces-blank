import { useEffect, useRef } from 'react';
import { TITLE_STILL_TIME, TitleScene, titleScale } from '../../engine/TitleScene';
import { useGameStore } from '../../store/useGameStore';

/**
 * Animated pixel-art night skyline + "HASH HARVEST TYCOON" logo for the title
 * screen. Fills its (positioned) parent; the menu panel goes on top. The scene
 * renders into a small logical buffer presented with an integer device-pixel
 * scale, pauses while the tab is hidden and draws a still frame when the user
 * prefers reduced motion.
 */
/** Frame budget of the backdrop animation (30 fps). */
const FRAME_MS = 1000 / 30;

export default function TitleBackdrop() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const view = canvas?.getContext('2d');
    if (!wrap || !canvas || !view) return undefined;

    const scene = new TitleScene(useGameStore.getState().settings.particles);
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let raf = 0;
    let last = 0;
    let time = 0;
    let dpr = window.devicePixelRatio || 1;

    const present = () => {
      view.imageSmoothingEnabled = false;
      view.drawImage(scene.buffer, 0, 0, canvas.width, canvas.height);
    };
    const still = () => {
      scene.render(motion.matches ? TITLE_STILL_TIME : time, 0);
      present();
    };
    const fit = () => {
      dpr = window.devicePixelRatio || 1;
      const devW = Math.round(wrap.clientWidth * dpr);
      const devH = Math.round(wrap.clientHeight * dpr);
      if (devW < 1 || devH < 1) return;
      const scale = titleScale(devW, devH);
      const bw = Math.ceil(devW / scale);
      const bh = Math.ceil(devH / scale);
      scene.resize(bw, bh);
      if (canvas.width !== bw * scale || canvas.height !== bh * scale) {
        canvas.width = bw * scale;
        canvas.height = bh * scale;
      }
      // Slightly larger than the box (< one logical pixel); the wrapper clips it.
      canvas.style.width = `${(bw * scale) / dpr}px`;
      canvas.style.height = `${(bh * scale) / dpr}px`;
      still();
    };
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      // A slow skyline does not need 60+ fps: every other frame halves the menu's CPU and battery use.
      if (now - last < FRAME_MS - 2) return;
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      time += dt;
      if ((window.devicePixelRatio || 1) !== dpr) fit();
      scene.render(time, dt);
      present();
    };
    const sync = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      if (motion.matches) {
        still();
        return;
      }
      if (document.hidden) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };

    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    fit();
    sync();
    document.addEventListener('visibilitychange', sync);
    motion.addEventListener('change', sync);
    const unsub = useGameStore.subscribe((s) => scene.setParticles(s.settings.particles));

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener('visibilitychange', sync);
      motion.removeEventListener('change', sync);
      unsub();
    };
  }, []);

  return (
    <div ref={wrapRef} aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden bg-[#07060f]">
      <canvas ref={canvasRef} className="absolute left-0 top-0 block" style={{ imageRendering: 'pixelated' }} />
    </div>
  );
}
