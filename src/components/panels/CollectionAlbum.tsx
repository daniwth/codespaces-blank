import { BookOpen } from 'lucide-react';
import { COLLECTION, COLLECTION_FAMILIES, collectionProgress, familyComplete, hasGrade } from '../../config/collection';
import { GPU_BY_ID, QUALITY_DEFS, QUALITY_ORDER } from '../../config/hardwareCatalog';
import { sprites } from '../../engine/SpriteManager';
import { useT } from '../../i18n';
import { useGameStore } from '../../store/useGameStore';
import { SpriteImg } from '../ui/SpriteImg';

/**
 * Silicon Collection: every GPU model in each of its four silicon grades. An entry is added the first
 * time a card of that model and grade is obtained (bought, fused, won). Completing every model of a
 * brand pays a small permanent hashrate bonus; the full album pays a bigger one.
 */
export function CollectionAlbum() {
  const t = useT();
  const collection = useGameStore((s) => s.collection);
  const progress = collectionProgress(collection);
  return (
    <section data-testid="collection">
      <h3 className="mb-1 flex flex-wrap items-center gap-2 font-pixel text-[9px] text-[#f0abfc]">
        <BookOpen size={13} /> {t('SILICON COLLECTION')}
        <span className="font-term text-[15px] normal-case text-dim" data-testid="collection-count">
          {t('{n}/{total} entries', { n: progress.entries, total: progress.total })}
        </span>
        <span className="ml-auto font-term text-[15px] normal-case text-lime">{t('+{pct}% hashrate, forever', { pct: ((progress.hashMul - 1) * 100).toFixed(0) })}</span>
      </h3>
      <p className="mb-1 text-[16px] leading-tight text-dim">
        {t('Obtain every model of a brand in all four silicon grades, Bronze to Silicon God, for +{family}% hashrate per brand. The full album adds +{album}%. The album survives The Halving.', { family: Math.round(COLLECTION.familyHash * 100), album: Math.round(COLLECTION.albumHash * 100) })}
      </p>
      <div className="flex flex-col gap-1.5">
        {COLLECTION_FAMILIES.map((family) => {
          const done = familyComplete(collection, family);
          return (
            <div key={family.brand} className="bg-panel-2 p-1.5" style={{ boxShadow: done ? 'inset 0 0 0 2px #a3e635' : undefined }} data-testid={`family-${family.brand}`}>
              <div className="mb-1 flex items-center gap-2 font-silk text-[10px] uppercase">
                <span className={done ? 'text-lime' : 'text-ink'}>{family.brand}</span>
                <span className={done ? 'text-lime' : 'text-dim'}>{done ? t('COMPLETE +{pct}%', { pct: Math.round(COLLECTION.familyHash * 100) }) : t('incomplete')}</span>
              </div>
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                {family.modelIds.map((id) => (
                  <div key={id} className="flex items-center gap-2 text-[15px] leading-tight">
                    <SpriteImg src={sprites.gpuIcon(id)} width={42} alt="" />
                    <span className="min-w-0 flex-1 truncate">{t(GPU_BY_ID[id].name)}</span>
                    <span className="flex gap-0.5" aria-label={t('{n} of 4 grades', { n: QUALITY_ORDER.filter((q) => hasGrade(collection, id, q)).length })}>
                      {QUALITY_ORDER.map((q) => {
                        const own = hasGrade(collection, id, q);
                        return (
                          <span
                            key={q}
                            className="size-3"
                            title={`${t(QUALITY_DEFS[q].label)}${own ? '' : ` (${t('missing')})`}`}
                            style={own ? { background: QUALITY_DEFS[q].color, boxShadow: `0 0 4px ${QUALITY_DEFS[q].color}` } : { boxShadow: `inset 0 0 0 1px ${QUALITY_DEFS[q].glow}` }}
                            data-owned={own}
                          />
                        );
                      })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
