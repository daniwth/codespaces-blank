import { Terminal } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useLang, useT } from '../../i18n';
import { logLine } from '../../store/logLine';
import { useGameStore } from '../../store/useGameStore';
import { formatClock } from '../../utils/formatters';

const TONE: Record<string, string> = { info: '#a5b4fc', good: '#a3e635', warn: '#fbbf24', bad: '#f43f5e' };

/** Scrolling system log rendered like an old green-screen terminal. */
export function EventLog() {
  const t = useT();
  const lang = useLang();
  const log = useGameStore((s) => s.log);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);
  return (
    <div className="pixel-box crt flex flex-col">
      <div className="relative z-[4] flex items-center gap-2 bg-[#03140b] px-3 py-1 font-pixel text-[8px] text-[#4ade80]">
        <Terminal size={12} /> SYSLOG://farm
      </div>
      <div ref={ref} className="retro-scroll relative z-[1] h-28 overflow-y-auto px-3 py-1 text-[17px] leading-[1.15]">
        {log.length === 0 && <div className="text-[#4ade80]/60">&gt; {t('boot ok. awaiting hashes_')}</div>}
        {log.map((e) => (
          <div key={e.id} className="flex gap-2" data-testid="log-line">
            <span className="shrink-0 text-[#166534]">{formatClock(e.t, lang)}</span>
            <span style={{ color: TONE[e.tone] }}>{logLine(e, lang)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
