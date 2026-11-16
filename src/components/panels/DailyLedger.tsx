import { BookOpen } from 'lucide-react';
import { useState } from 'react';
import { localDay } from '../../config/daily';
import { useT } from '../../i18n';
import { ledgerNet } from '../../store/gamePhysics';
import { useGameStore } from '../../store/useGameStore';
import { formatCash, formatDate } from '../../utils/formatters';

/** Local midnight of a ledger day, for the date label. */
const dayStart = (day: number): number => {
  const utc = day * 86_400_000;
  return utc + new Date(utc).getTimezoneOffset() * 60_000;
};

/** Daily books: one bar per day (net result) and the breakdown of the day picked. */
export function DailyLedger() {
  const t = useT();
  const ledger = useGameStore((s) => s.ledger);
  const [picked, setPicked] = useState<number | null>(null);
  const today = localDay();
  const shown = ledger.find((d) => d.day === picked) ?? ledger[ledger.length - 1];
  const scale = Math.max(1e-9, ...ledger.map((d) => Math.abs(ledgerNet(d))));
  const label = (day: number): string => (day === today ? t('Today') : day === today - 1 ? t('Yesterday') : formatDate(dayStart(day)));
  return (
    <section data-testid="daily-ledger">
      <h3 className="mb-1 flex items-center gap-2 font-pixel text-[9px] text-neon">
        <BookOpen size={14} /> {t('DAILY BOOKS')}
      </h3>
      {!shown ? (
        <p className="bg-panel-2 p-2 text-[16px] text-dim">{t('No books yet: they open with the first coin mined.')}</p>
      ) : (
        <div className="bg-panel-2 p-2">
          <div className="flex h-16 items-stretch gap-1" role="list">
            {ledger.map((d) => {
              const net = ledgerNet(d);
              const h = Math.max(4, Math.round((Math.abs(net) / scale) * 50));
              return (
                <button
                  key={d.day}
                  type="button"
                  role="listitem"
                  className="flex min-w-0 flex-1 flex-col"
                  style={{ boxShadow: d.day === shown.day ? 'inset 0 0 0 1px #8f89c4' : undefined }}
                  onClick={() => setPicked(d.day)}
                  title={`${label(d.day)}: ${formatCash(net)}`}
                  aria-label={`${label(d.day)}: ${formatCash(net)}`}
                  aria-pressed={d.day === shown.day}
                  data-testid="ledger-bar"
                >
                  {/* Profit grows up from the middle line, a loss hangs below it. */}
                  <span className="flex flex-1 items-end">{net >= 0 && <span className="w-full bg-lime" style={{ height: `${h}%` }} />}</span>
                  <span className="h-px bg-[#3a3470]" />
                  <span className="flex flex-1 items-start">{net < 0 && <span className="w-full bg-[#f43f5e]" style={{ height: `${h}%` }} />}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-1.5 grid grid-cols-[1fr_auto] gap-x-3 text-[16px] leading-tight" data-testid="ledger-day">
            <span className="font-pixel text-[9px] text-ink">{label(shown.day)}</span>
            <span />
            <span className="text-dim">{t('Coins mined (at market price)')}</span>
            <span className="text-right text-lime">+{formatCash(shown.mined)}</span>
            <span className="text-dim">{t('Trading profit')}</span>
            <span className="text-right" style={{ color: shown.sold >= 0 ? '#facc15' : '#f43f5e' }}>{shown.sold >= 0 ? '+' : ''}{formatCash(shown.sold)}</span>
            <span className="text-dim">{t('Electricity')}</span>
            <span className="text-right text-[#fbbf24]">-{formatCash(shown.electricity)}</span>
            <span className="text-dim">{t('Automatic maintenance')}</span>
            <span className="text-right text-[#fb923c]">-{formatCash(shown.upkeep)}</span>
            <span className="border-t border-[#3a3470] pt-0.5 text-ink">{t('Net result')}</span>
            <span className="border-t border-[#3a3470] pt-0.5 text-right font-pixel text-[10px]" style={{ color: ledgerNet(shown) >= 0 ? '#a3e635' : '#f43f5e' }} data-testid="ledger-net">
              {formatCash(ledgerNet(shown))}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
