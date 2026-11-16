import { Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ENERGY, PPA_PLANS, PPA_PLAN_IDS, SPOT_MAX, SPOT_MIN, gridSpot, ppaActive, ppaCancelFee, ppaQuote } from '../../config/energy';
import { researchModifiers } from '../../config/research';
import { useT } from '../../i18n';
import { useGameShallow, useGameStore } from '../../store/useGameStore';
import { formatCash, formatDuration } from '../../utils/formatters';
import { PixelButton } from '../ui/PixelButton';

/** Minutes of forecast drawn (the index is a function of the clock, so the forecast is exact). */
const FORECAST_SEC = 30 * 60;
const W = 300;
const H = 54;

const pct = (v: number): string => `${Math.round(v * 100)}%`;
const y = (v: number): number => H - 3 - ((v - SPOT_MIN) / (SPOT_MAX - SPOT_MIN)) * (H - 6);

/** Wholesale power: spot index with its forecast, and fixed-rate contracts (Energy Desk research). */
export function EnergyDesk() {
  const t = useT();
  const s = useGameShallow((st) => ({
    desk: researchModifiers(st.research.levels).energyDesk,
    ppa: st.ppa,
    bill: st.live.electricityPerSec,
    spot: st.live.gridSpot,
  }));
  const { signPpa, cancelPpa, setSideTab } = useGameStore.getState();
  // The curve and the quotes move with the clock, not with the store.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!s.desk) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [s.desk]);

  const active = ppaActive(s.ppa, now) ? s.ppa : null;
  const points = Array.from({ length: 61 }, (_, i) => {
    const at = now + (i / 60) * FORECAST_SEC * 1000;
    return `${((i / 60) * W).toFixed(1)},${y(gridSpot(at)).toFixed(1)}`;
  }).join(' ');
  const spot = gridSpot(now);

  return (
    <div className="border-t-2 border-[#1b1838] pt-2" data-testid="energy-desk">
      <div className="mb-2 flex items-center gap-2">
        <Zap size={14} className="text-[#fde047]" />
        <span className="font-pixel text-[9px] text-[#fde047]">{t('POWER MARKET')}</span>
        {s.desk && <span className="text-[15px] text-dim" data-testid="energy-spot">{t('spot {pct} of retail', { pct: pct(spot) })}</span>}
      </div>
      {!s.desk ? (
        <p className="text-[16px] leading-tight text-dim">
          {t('Wholesale power is cheaper on average but its price swings. A power contract locks a fixed rate.')}{' '}
          <button type="button" className="text-neon underline" onClick={() => setSideTab('lab')}>{t('Research the Energy Desk in the Lab.')}</button>
        </p>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full bg-[#05040c]" role="img" aria-label={t('Spot price forecast for the next {min} minutes', { min: FORECAST_SEC / 60 })} data-testid="energy-forecast">
            <line x1={0} x2={W} y1={y(1)} y2={y(1)} stroke="#3a3470" strokeDasharray="2 3" />
            <line x1={0} x2={W} y1={y(ENERGY.mean)} y2={y(ENERGY.mean)} stroke="#4ade8066" strokeDasharray="1 4" />
            {active && <line x1={0} x2={Math.min(W, ((active.endsAt - now) / 1000 / FORECAST_SEC) * W)} y1={y(active.rate)} y2={y(active.rate)} stroke="#22d3ee" strokeWidth={2} />}
            <polyline points={points} fill="none" stroke="#fde047" strokeWidth={1.5} />
            <circle cx={1.5} cy={y(spot)} r={2.5} fill="#fde047" />
          </svg>
          <div className="mt-0.5 flex justify-between text-[13px] leading-none text-dim">
            <span>{t('now')}</span>
            <span>{t('retail 100% (dashed) · average {pct}', { pct: pct(ENERGY.mean) })}</span>
            <span>+{FORECAST_SEC / 60} min</span>
          </div>
          {active ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 bg-panel-2 p-1.5 text-[16px] leading-tight" data-testid="ppa-active">
              <span className="font-pixel text-[8px] text-neon">{t(PPA_PLANS[active.plan].name).toUpperCase()}</span>
              <span>{t('fixed at {pct}', { pct: pct(active.rate) })}</span>
              <span className="text-dim">{t('{time} left', { time: formatDuration(Math.max(0, Math.round((active.endsAt - now) / 1000))) })}</span>
              <span style={{ color: active.saved >= 0 ? '#a3e635' : '#f43f5e' }} data-testid="ppa-saved">
                {active.saved >= 0 ? t('saved {cash} vs spot', { cash: formatCash(active.saved) }) : t('cost {cash} more than spot', { cash: formatCash(-active.saved) })}
              </span>
              <PixelButton size="xs" variant="ghost" className="ml-auto" onClick={() => cancelPpa()} title={t('Early termination fee: {pct}% of what the contract would still bill.', { pct: Math.round(ENERGY.cancelFee * 100) })} data-testid="ppa-cancel">
                {t('Cancel ({fee})', { fee: formatCash(ppaCancelFee(active, s.bill, now)) })}
              </PixelButton>
            </div>
          ) : (
            <div className="mt-1.5 grid grid-cols-1 gap-1 sm:grid-cols-2">
              {PPA_PLAN_IDS.map((id) => {
                const plan = PPA_PLANS[id];
                const quote = ppaQuote(id, now);
                return (
                  <div key={id} className="flex items-center gap-2 bg-panel-2 p-1.5 text-[16px] leading-tight">
                    <span className="min-w-0 flex-1">
                      <span className="block font-pixel text-[8px] text-ink">{t(plan.name).toUpperCase()}</span>
                      <span className="block text-dim">{t('{time} at a fixed rate', { time: formatDuration(plan.durationSec) })}</span>
                    </span>
                    <span className="font-pixel text-[10px]" style={{ color: quote <= ENERGY.mean ? '#a3e635' : quote < 1 ? '#fbbf24' : '#f43f5e' }} data-testid={`ppa-quote-${id}`}>{pct(quote)}</span>
                    <PixelButton size="xs" variant="success" onClick={() => signPpa(id)} data-testid={`ppa-sign-${id}`}>
                      {t('Sign')}
                    </PixelButton>
                  </div>
                );
              })}
              <p className="text-[14px] leading-tight text-dim sm:col-span-2">{t('Quotes follow the spot price: sign in a trough to lock a cheap rate. Offline, uncontracted power bills the average.')}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
