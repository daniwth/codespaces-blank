import { useState, type ReactNode } from 'react';
import { useT } from '../../i18n';
import { diagnoseFarm, farmPnl } from '../../store/gamePhysics';
import { useGameShallow } from '../../store/useGameStore';
import { formatCash } from '../../utils/formatters';

const SEVERITY_COLOR = { 3: '#f43f5e', 2: '#fbbf24', 1: '#8f89c4' } as const;

/** Live profit and loss per second plus what is holding the farm back right now. */
function DiagnosisPanel() {
  const t = useT();
  const s = useGameShallow((st) => ({
    live: st.live, pool: st.pool, price: st.market[st.minedCoin].price, coin: st.minedCoin,
    racks: st.racks, gpus: st.gpus, ownedRooms: st.ownedRooms, talents: st.talents, challenge: st.challenge,
  }));
  const pnl = farmPnl(s.live, s.pool, s.price);
  const issues = diagnoseFarm(s, s.live);
  const top = issues[0];
  const row = (label: string, value: number, color: string, sign: '+' | '-') => (
    <>
      <span className="text-dim">{label}</span>
      <span className="text-right" style={{ color }}>{sign === '-' && value > 0 ? '-' : ''}{formatCash(value, 3)}/s</span>
    </>
  );
  return (
    <div className="flex flex-col gap-1.5 text-[16px] leading-tight" data-testid="hud-diagnosis">
      <div className="font-pixel text-[9px] text-neon">{t('LIVE P&L (${coin} at market price)', { coin: s.coin })}</div>
      <div className="grid grid-cols-[1fr_auto] gap-x-3">
        {row(t('Gross mining'), pnl.gross, '#a3e635', '+')}
        {row(t('Electricity'), pnl.electricity, '#fbbf24', '-')}
        {row(t('Pool and market fees'), pnl.fees, '#fb923c', '-')}
        <span className="border-t border-[#3a3470] pt-0.5 text-ink">{t('Net profit')}</span>
        <span className="border-t border-[#3a3470] pt-0.5 text-right font-pixel text-[10px]" style={{ color: pnl.net >= 0 ? '#a3e635' : '#f43f5e' }} data-testid="hud-net">
          {formatCash(pnl.net, 3)}/s
        </span>
      </div>
      <div className="font-pixel text-[9px] text-neon">{t('BOTTLENECK')}</div>
      {top ? (
        <ul className="flex flex-col gap-0.5" data-testid="hud-bottleneck">
          {issues.slice(0, 4).map((b) => (
            <li key={`${b.id}-${JSON.stringify(b.params)}`} className="flex gap-1.5" data-bottleneck={b.id}>
              <span style={{ color: SEVERITY_COLOR[b.severity] }}>{b.severity === 3 ? '■' : b.severity === 2 ? '▲' : '●'}</span>
              <span style={{ color: b === top ? '#e9e6ff' : '#8f89c4' }}>
                {t(b.key, Object.fromEntries(Object.entries(b.params).map(([k, v]) => [k, typeof v === 'string' ? t(v) : v])))}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-lime" data-testid="hud-bottleneck">{t('None: every rig is running flat out.')}</div>
      )}
    </div>
  );
}

/**
 * Wraps a HUD stat: hovering, focusing or tapping it opens the diagnosis below it. The panel is only
 * mounted while open, so the per-tick diagnosis costs nothing the rest of the time.
 */
export function DiagnosisPopover({ children, label, testId }: { children: ReactNode; label: string; testId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <button type="button" className="block cursor-help text-left" aria-label={label} aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid={testId}>
        {children}
      </button>
      {open && (
        // The positioned wrapper stays out of the flow; `pixel-box` sets its own `position`.
        <div className="absolute left-0 top-full z-40 mt-1 w-[min(21rem,86vw)]" role="tooltip">
          <div className="pixel-box pixel-box-hi p-2">
            <DiagnosisPanel />
          </div>
        </div>
      )}
    </div>
  );
}
