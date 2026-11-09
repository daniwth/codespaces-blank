import { Moon } from 'lucide-react';
import { useT } from '../../i18n';
import { useGameStore } from '../../store/useGameStore';
import { formatCash, formatDuration, formatNumber } from '../../utils/formatters';
import { PixelButton } from '../ui/PixelButton';
import { PixelModal } from '../ui/PixelModal';

/** Retro "welcome back" report for offline progress. */
export function OfflineModal() {
  const t = useT();
  const report = useGameStore((s) => s.offlineReport);
  const dismiss = useGameStore((s) => s.dismissOffline);
  if (!report) return null;
  const capped = report.requested > report.seconds + 1;
  return (
    <PixelModal title={<span className="flex items-center gap-2"><Moon size={14} /> {t('Welcome back, miner')}</span>} onClose={dismiss} className="max-w-lg" accent="#a3e635">
      <div className="crt p-4 text-[20px] leading-tight text-[#4ade80]">
        <div className="relative z-[4]">
          <p>&gt; {t('Your rigs kept hashing for {time}.', { time: formatDuration(report.seconds) })}</p>
          {capped && <p className="text-[#fbbf24]">&gt; {t('Offline window capped (away {time}). Night Shift talents extend it.', { time: formatDuration(report.requested) })}</p>}
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1">
            <span>{t('$CC mined')}</span>
            <span className="text-right text-[#22d3ee]">+{formatNumber(report.ccMined)}</span>
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
          <p className="mt-3 text-[16px] text-[#4ade80]/70">{t("Network events and raids pause while you're away. Solo pools pay their expected value.")}</p>
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <PixelButton variant="success" onClick={dismiss}>
          {t('Collect')}
        </PixelButton>
      </div>
    </PixelModal>
  );
}
