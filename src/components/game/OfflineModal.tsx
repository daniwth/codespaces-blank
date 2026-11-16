import { Moon, PaintBucket, Wrench } from 'lucide-react';
import { useT } from '../../i18n';
import { useGameStore } from '../../store/useGameStore';
import { formatCash, formatDuration, formatNumber } from '../../utils/formatters';
import { PixelButton } from '../ui/PixelButton';
import { PixelModal } from '../ui/PixelModal';

const TONE_COLOR = { info: '#4ade80', good: '#a3e635', warn: '#fbbf24', bad: '#f87171' } as const;

/** Retro "welcome back" report for offline progress. */
export function OfflineModal() {
  const t = useT();
  const report = useGameStore((s) => s.offlineReport);
  const dismiss = useGameStore((s) => s.dismissOffline);
  const repasteAll = useGameStore((s) => s.repasteAll);
  const repairAll = useGameStore((s) => s.repairAll);
  if (!report) return null;
  const { events, todo } = report.digest;
  const params = (p: Record<string, string | number>) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, typeof v === 'string' ? t(v) : v]));
  const needs = (id: string) => todo.some((b) => b.id === id);
  const capped = report.requested > report.seconds + 1;
  return (
    <PixelModal title={<span className="flex items-center gap-2"><Moon size={14} /> {t('Welcome back, miner')}</span>} onClose={dismiss} className="max-w-lg" accent="#a3e635">
      <div className="crt p-4 text-[20px] leading-tight text-[#4ade80]">
        <div className="relative z-[4]">
          <p>&gt; {t('Your rigs kept hashing for {time}.', { time: formatDuration(report.seconds) })}</p>
          {capped && <p className="text-[#fbbf24]">&gt; {t('Offline window capped (away {time}). Night Shift talents extend it.', { time: formatDuration(report.requested) })}</p>}
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1">
            <span>{t('{coin} mined', { coin: `$${report.minedCoin}` })}</span>
            <span className="text-right text-[#22d3ee]">+{formatNumber(report.coinMined)}</span>
            <span>{t('Electricity bill')}</span>
            <span className="text-right text-[#f87171]">-{formatCash(report.electricity)}</span>
            <span>{t('Bot / VIP sales')}</span>
            <span className="text-right text-[#facc15]">+{formatCash(report.earnedCash)}</span>
            <span>{t('Net cash')}</span>
            <span className="text-right" style={{ color: report.cashDelta >= 0 ? '#a3e635' : '#f87171' }}>
              {report.cashDelta >= 0 ? '+' : ''}
              {formatCash(report.cashDelta)}
            </span>
          </div>
          {events.length > 0 && (
            <ul className="mt-3 flex flex-col gap-0.5 text-[17px]" data-testid="offline-events">
              {events.map((e) => (
                <li key={e.id} style={{ color: TONE_COLOR[e.tone] }} data-event={e.id}>&gt; {t(e.key, params(e.params))}</li>
              ))}
            </ul>
          )}
          <div className="mt-3 font-pixel text-[9px] text-[#a3e635]">{t('DO FIRST')}</div>
          {todo.length > 0 ? (
            <ol className="mt-1 flex flex-col gap-0.5 text-[17px]" data-testid="offline-todo">
              {todo.map((b, i) => (
                <li key={`${b.id}-${i}`} style={{ color: b.severity === 3 ? '#f87171' : '#fbbf24' }} data-todo={b.id}>{i + 1}. {t(b.key, params(b.params))}</li>
              ))}
            </ol>
          ) : (
            <p className="mt-1 text-[17px]" data-testid="offline-todo">{t('Nothing urgent: the farm is healthy.')}</p>
          )}
          <p className="mt-3 text-[16px] text-[#4ade80]/70">{t("Network events and raids pause while you're away. Solo pools pay their expected value.")}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {needs('paste_worn') && (
          <PixelButton variant="secondary" icon={<PaintBucket size={12} />} onClick={() => repasteAll()} data-testid="offline-repaste">
            {t('Re-paste all')}
          </PixelButton>
        )}
        {needs('worn_gpus') && (
          <PixelButton variant="secondary" icon={<Wrench size={12} />} onClick={() => repairAll()} data-testid="offline-repair">
            {t('Repair all')}
          </PixelButton>
        )}
        <PixelButton variant="success" onClick={dismiss}>
          {t('Collect')}
        </PixelButton>
      </div>
    </PixelModal>
  );
}
