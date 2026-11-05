import { useEffect } from 'react';
import { GPU_BY_ID, QUALITY_DEFS } from '../../config/hardwareCatalog';
import { sprites } from '../../engine/SpriteManager';
import { useGameStore } from '../../store/useGameStore';
import { SpriteImg } from './SpriteImg';

/** Pop-up revealing the silicon quality of a freshly bought GPU. */
export function LotteryToast() {
  const lottery = useGameStore((s) => s.lottery);
  const dismiss = useGameStore((s) => s.dismissLottery);
  useEffect(() => {
    if (!lottery) return undefined;
    const t = setTimeout(dismiss, 2600);
    return () => clearTimeout(t);
  }, [lottery, dismiss]);
  if (!lottery) return null;
  const q = QUALITY_DEFS[lottery.quality];
  const model = GPU_BY_ID[lottery.modelId];
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-40 -translate-x-1/2" key={lottery.t}>
      <div className="pop-in flex items-center gap-3 bg-[#0b0a18] px-4 py-3" style={{ boxShadow: `0 0 0 3px ${q.color}, 0 0 24px ${q.color}88` }}>
        <SpriteImg src={sprites.gpuIcon(model.id)} width={96} alt={model.name} />
        <div className="leading-tight">
          <div className="font-silk text-[10px] text-dim">SILICON LOTTERY</div>
          <div className={`font-pixel text-[13px] ${lottery.quality === 'god' ? 'gold-shimmer' : ''}`} style={lottery.quality === 'god' ? undefined : { color: q.color }}>
            {q.label.toUpperCase()}!
          </div>
          <div className="text-[16px] text-ink">
            {model.brand} {model.name}
          </div>
        </div>
      </div>
    </div>
  );
}
