import { Lightbulb, X } from 'lucide-react';
import { HINT_BY_ID } from '../../config/hints';
import { useT } from '../../i18n';
import { useGameStore } from '../../store/useGameStore';
import { PixelButton } from './PixelButton';

/** One-time contextual tip. It never blocks the game: it sits in a corner until dismissed. */
export function HintToast() {
  const t = useT();
  const id = useGameStore((s) => s.activeHint);
  const dismiss = useGameStore((s) => s.dismissHint);
  const setSideTab = useGameStore((s) => s.setSideTab);
  const updateSettings = useGameStore((s) => s.updateSettings);
  const hint = id ? HINT_BY_ID[id] : undefined;
  if (!hint) return null;
  const tab = hint.tab;
  return (
    <div className="fixed bottom-4 left-3 z-30 w-[min(92vw,340px)]" role="status" aria-live="polite" data-testid="hint-toast" data-hint={hint.id}>
      <div className="pop-in flex gap-2 bg-[#0b0a18] p-2" style={{ boxShadow: '0 0 0 3px #22d3ee, 0 0 18px #22d3ee66' }}>
        <span className="grid size-8 shrink-0 place-items-center bg-[#22d3ee22] text-[#22d3ee] shadow-[inset_0_0_0_2px_#22d3ee88]">
          <Lightbulb size={16} />
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="flex items-start justify-between gap-2">
            <span className="font-pixel text-[9px] text-[#22d3ee]">{t(hint.title).toUpperCase()}</span>
            <button type="button" className="text-dim hover:text-ink" onClick={dismiss} aria-label={t('Close')} data-testid="hint-close">
              <X size={14} />
            </button>
          </div>
          <p className="mt-0.5 text-[16px] text-ink">{t(hint.text, hint.params)}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {tab && (
              <PixelButton size="xs" variant="primary" onClick={() => { setSideTab(tab); dismiss(); }} data-testid="hint-go" silent>
                {t('Show me')}
              </PixelButton>
            )}
            <PixelButton size="xs" variant="ghost" onClick={dismiss} silent>
              {t('Got it')}
            </PixelButton>
            <button type="button" className="ml-auto text-[14px] text-dim underline hover:text-ink" onClick={() => { updateSettings({ hints: false }); dismiss(); }} data-testid="hint-off">
              {t('No more hints')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
