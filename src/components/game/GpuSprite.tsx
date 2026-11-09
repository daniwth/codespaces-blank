import { GPU_BY_ID, COOLER_BY_ID } from '../../config/hardwareCatalog';
import { sprites } from '../../engine/SpriteManager';
import { usePixelAnimation } from '../../hooks/usePixelAnimation';
import { useT } from '../../i18n';
import { useGameStore } from '../../store/useGameStore';

interface GpuSpriteProps {
  gpuUid: string;
  scale?: number;
}

/** Live animated GPU sprite (spinning fans, temperature LED) for HTML panels. */
export function GpuSprite({ gpuUid, scale = 2 }: GpuSpriteProps) {
  const t = useT();
  const modelId = useGameStore((s) => s.gpus[gpuUid]?.modelId);
  const model = modelId ? GPU_BY_ID[modelId] : undefined;
  const w = 48;
  const h = model?.style === 'card' ? 18 : 20;
  const ref = usePixelAnimation(({ ctx, time }) => {
    const s = useGameStore.getState();
    const g = s.gpus[gpuUid];
    if (!g || !model) return;
    const live = s.live.gpus[gpuUid];
    sprites.drawGpu(ctx, model, 0, 0, w, h, time, {
      running: !!live?.running,
      load: live?.load ?? 0,
      temp: g.temp,
      shutdown: g.shutdown,
      throttled: !!live?.throttled,
    });
  }, w, h);
  if (!model) return null;
  return <canvas ref={ref} className="pixelated shrink-0" style={{ width: w * scale, height: h * scale }} aria-label={t(model.name)} />;
}

/** Animated cooler sprite (fans spin, immersion tanks bubble). */
export function CoolerSprite({ modelId, spinning, scale = 3 }: { modelId: string; spinning: boolean; scale?: number }) {
  const t = useT();
  const model = COOLER_BY_ID[modelId];
  const ref = usePixelAnimation(({ ctx, time }) => {
    const speed = model.kind === 'immersion' ? 5 : model.kind === 'cryo' ? 3 : 14;
    ctx.drawImage(sprites.cooler(model, 18, 18, spinning ? Math.floor(time * speed) : 0), 0, 0);
  }, 18, 18, 24);
  return <canvas ref={ref} className="pixelated shrink-0" style={{ width: 18 * scale, height: 18 * scale }} aria-label={t(model.name)} />;
}
