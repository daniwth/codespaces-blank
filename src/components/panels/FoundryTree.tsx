import { Check, Factory, Lock } from 'lucide-react';
import { FOUNDRY_NODES, foundryState, type ChipFamily, type FoundryNode } from '../../config/foundry';
import { useT } from '../../i18n';
import { useGameShallow, useGameStore } from '../../store/useGameStore';
import { bnGte } from '../../utils/bignum';
import { formatCash } from '../../utils/formatters';
import { PixelButton } from '../ui/PixelButton';

const BRANCH_TITLE: Record<ChipFamily, string> = { card: 'GRAPHICS CARDS', asic: 'IN-HOUSE ASICS' };

/** Chip Foundry: Clean Room on top, then the graphics card branch and the ASIC branch side by side. */
export function FoundryTree() {
  const t = useT();
  const s = useGameShallow((st) => ({ foundry: st.foundry, cash: st.cash }));
  const buy = useGameStore((st) => st.buyFoundryNode);

  const node = (n: FoundryNode) => {
    const state = foundryState(s.foundry, n.id);
    const affordable = bnGte(s.cash, n.price);
    return (
      <div
        key={n.id}
        className={`flex items-start gap-2 bg-panel-2 p-2 text-[16px] leading-tight ${state === 'locked' || state === 'excluded' ? 'opacity-55' : ''}`}
        style={{ boxShadow: state === 'owned' ? `inset 0 0 0 2px ${n.color}` : undefined }}
        data-testid={`foundry-${n.id}`}
        data-state={state}
      >
        <div className="min-w-0 flex-1">
          <div style={{ color: n.color }}>{t(n.name)}</div>
          <div className="text-dim">{t(n.description)}</div>
          {state === 'excluded' && <div className="text-hot">{t('Locked: the fab specialized in the other family.')}</div>}
        </div>
        {state === 'owned' ? (
          <Check size={16} className="mt-0.5 shrink-0" style={{ color: n.color }} aria-label={t('OWNED')} />
        ) : state === 'available' ? (
          <PixelButton size="xs" variant={affordable ? 'gold' : 'secondary'} disabled={!affordable} onClick={() => buy(n.id)} className="shrink-0" data-testid={`foundry-buy-${n.id}`} silent>
            {formatCash(n.price)}
          </PixelButton>
        ) : (
          <Lock size={14} className="mt-0.5 shrink-0 text-dim" aria-label={t('Locked')} />
        )}
      </div>
    );
  };

  return (
    <section className="flex flex-col gap-1.5" data-testid="foundry">
      <h3 className="flex items-center gap-2 font-pixel text-[9px] text-[#e2e8f0]">
        <Factory size={14} /> {t('CHIP FOUNDRY')}
        <span className="font-term text-[14px] normal-case text-dim">{s.foundry.length}/{FOUNDRY_NODES.length - 1}</span>
      </h3>
      <p className="text-[15px] leading-tight text-dim">{t('Bought with cash, for this run. Both branches can be climbed, but only one capstone: the fab specializes.')}</p>
      {FOUNDRY_NODES.filter((n) => n.branch === 'root').map(node)}
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {(['card', 'asic'] as const).map((branch) => (
          <div key={branch} className="flex flex-col gap-1.5">
            <div className="font-pixel text-[8px] text-dim">{t(BRANCH_TITLE[branch])}</div>
            {FOUNDRY_NODES.filter((n) => n.branch === branch).map(node)}
          </div>
        ))}
      </div>
    </section>
  );
}
