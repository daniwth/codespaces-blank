import { Keyboard } from 'lucide-react';
import { useT } from '../../i18n';
import { PixelModal } from './PixelModal';

/** Shortcut list shown by the guide. `keys` are drawn as key caps. */
export const HOTKEYS: { keys: string[]; label: string }[] = [
  { keys: ['1', '…', '9', '0'], label: 'Open a side tab (Shop, Rigs, Lab, Market, Pools, Contracts, Halving, VIP, Trophies, Account)' },
  { keys: ['T'], label: 'Toggle the thermal view of the room' },
  { keys: ['R'], label: 'Quick maintenance in this room: re-paste (below 50%) and repair every GPU' },
  { keys: ['B'], label: 'Open the BIOS of the selected rack (or of the first rack in the room)' },
  { keys: ['M'], label: 'Mute or unmute all sound' },
  { keys: ['?'], label: 'Show this guide' },
  { keys: ['Esc'], label: 'Close the window on top' },
];

/** Compact keyboard guide (key ?). */
export function HotkeysModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  return (
    <PixelModal title={<span className="flex items-center gap-2"><Keyboard size={14} /> {t('Keyboard shortcuts')}</span>} onClose={onClose} className="max-w-xl" accent="#a3e635">
      <ul className="flex flex-col gap-1.5 text-[17px] leading-tight" data-testid="hotkeys">
        {HOTKEYS.map((h) => (
          <li key={h.label} className="flex items-start gap-3">
            <span className="flex w-32 shrink-0 flex-wrap gap-1">
              {h.keys.map((k) => (
                k === '…'
                  ? <span key={k} className="text-dim">…</span>
                  : <kbd key={k} className="bg-panel-3 px-1.5 py-0.5 font-pixel text-[9px] text-lime shadow-[inset_0_-2px_0_0_#07060f,0_0_0_1px_#3a3470]">{k}</kbd>
              ))}
            </span>
            <span className="min-w-0 flex-1 text-ink/90">{t(h.label)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[15px] leading-tight text-dim">{t('Shortcuts are ignored while you type in a field or a window is open.')}</p>
    </PixelModal>
  );
}
