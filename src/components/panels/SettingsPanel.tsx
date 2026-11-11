import { Download, FileUp, House, RotateCcw, Save, ShieldCheck } from 'lucide-react';
import { useRef, useState } from 'react';
import { SAVE_VERSION } from '../../config/gameBalance';
import { factoryReset, goToMainMenu } from '../../store/session';
import { gameStorage, useGameShallow, useGameStore } from '../../store/useGameStore';
import type { LoopMode } from '../../hooks/useGameLoop';
import { formatDate } from '../../utils/formatters';
import { PixelButton } from '../ui/PixelButton';
import { LANGS, tr, useLangStore, useT } from '../../i18n';

/**
 * Audio/video toggles, save export/import and factory reset. Rendered in the
 * System tab and, with `inMenu`, inside the title screen's Settings window.
 */
export function SettingsPanel({ loopMode, inMenu = false }: { loopMode: LoopMode | null; inMenu?: boolean }) {
  const t = useT();
  const lang = useLangStore((s) => s.lang);
  const setLang = useLangStore((s) => s.setLang);
  const settings = useGameShallow((s) => s.settings);
  const createdAt = useGameStore((s) => s.createdAt);
  const { updateSettings, exportSave, importSave, pushLog } = useGameStore.getState();
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const doExport = async () => {
    const code = await exportSave();
    setText(code);
    try {
      await navigator.clipboard.writeText(code);
      setMsg({ ok: true, text: t('Save exported and copied to the clipboard (SHA-256 signed).') });
    } catch {
      setMsg({ ok: true, text: t('Save exported below (SHA-256 signed).') });
    }
  };

  const doDownload = async () => {
    const code = await exportSave();
    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hash-harvest-save-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const doImport = async (code: string) => {
    const res = await importSave(code);
    setMsg({ ok: res.ok, text: t(res.message) });
  };

  return (
    <div className="flex flex-col gap-3 text-[17px]">
      {!inMenu && (
        <section className="flex flex-wrap items-center gap-2 bg-panel-2 p-2">
          <PixelButton size="sm" variant="primary" icon={<House size={11} />} onClick={goToMainMenu}>
            {t('Main menu')}
          </PixelButton>
          <span className="min-w-0 flex-1 text-[15px] leading-tight text-dim">{t('Saves and returns to the title screen. Time spent there counts as offline time.')}</span>
        </section>
      )}
      <section className="flex flex-col gap-2 bg-panel-2 p-2">
        <h3 className="font-pixel text-[9px] text-neon">{t('LANGUAGE')}</h3>
        <div className="flex gap-2" role="radiogroup" aria-label={t('Language')}>
          {LANGS.map((l) => (
            <PixelButton key={l.id} size="sm" variant={lang === l.id ? 'primary' : 'ghost'} aria-pressed={lang === l.id} onClick={() => setLang(l.id)}>
              {l.label}
            </PixelButton>
          ))}
        </div>
      </section>
      <section className="flex flex-col gap-2 bg-panel-2 p-2">
        <h3 className="font-pixel text-[9px] text-neon">{t('AUDIO & VIDEO')}</h3>
        <label className="flex items-center gap-2">
          <span className="w-28 text-dim">{t('Volume')}</span>
          <input type="range" min={0} max={1} step={0.05} value={settings.volume} onChange={(e) => updateSettings({ volume: Number(e.target.value) })} className="flex-1 accent-cyan-400" />
          <span className="w-10 text-right">{Math.round(settings.volume * 100)}</span>
        </label>
        {([
          ['muted', 'Mute all sound'],
          ['ambientHum', 'Fan hum ambience'],
          ['particles', 'Particles (smoke, coins)'],
          ['offlineProgress', 'Offline earnings'],
        ] as const).map(([key, label]) => (
          <label key={key} className="flex items-center gap-2">
            <input type="checkbox" checked={settings[key]} onChange={(e) => updateSettings({ [key]: e.target.checked })} />
            {t(label)}
          </label>
        ))}
      </section>

      <section className="flex flex-col gap-2 bg-panel-2 p-2">
        <h3 className="flex items-center gap-2 font-pixel text-[9px] text-neon">
          <ShieldCheck size={12} /> {t('SAVE DATA')} (v{SAVE_VERSION})
        </h3>
        <p className="leading-tight text-dim">{t('Autosaves to localStorage every 2s. Exports are Base64 JSON signed with a SHA-256 checksum, so edited or damaged saves are rejected.')}</p>
        <div className="flex flex-wrap gap-1">
          <PixelButton size="xs" variant="primary" icon={<Save size={10} />} onClick={() => { gameStorage.flush(); pushLog(tr('Game saved.'), 'info'); setMsg({ ok: true, text: t('Saved to this browser.') }); }}>
            {t('Save now')}
          </PixelButton>
          <PixelButton size="xs" icon={<Download size={10} />} onClick={doExport}>
            {t('Export')}
          </PixelButton>
          <PixelButton size="xs" icon={<Download size={10} />} onClick={doDownload}>
            {t('Download')}
          </PixelButton>
          <PixelButton size="xs" icon={<FileUp size={10} />} onClick={() => fileRef.current?.click()}>
            {t('Load file')}
          </PixelButton>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.json,text/plain"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) await doImport(await file.text());
              e.target.value = '';
            }}
          />
        </div>
        <textarea className="retro-input h-24 w-full resize-y text-[14px] leading-tight" placeholder={t('Paste an exported save here…')} value={text} onChange={(e) => setText(e.target.value)} />
        <PixelButton size="xs" variant="success" disabled={!text.trim()} onClick={() => doImport(text)}>
          {t('Import pasted save')}
        </PixelButton>
        {msg && <p className={msg.ok ? 'text-lime' : 'text-hot'}>{msg.text}</p>}
      </section>

      <section className="flex flex-col gap-2 bg-panel-2 p-2">
        <h3 className="font-pixel text-[9px] text-hot">{t('DANGER ZONE')}</h3>
        {!confirmReset ? (
          <PixelButton size="xs" variant="danger" icon={<RotateCcw size={10} />} onClick={() => setConfirmReset(true)}>
            {t('Factory reset')}
          </PixelButton>
        ) : (
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-hot">{t('Erase everything, including talents?')}</span>
            <PixelButton size="xs" variant="danger" onClick={() => { factoryReset(); setConfirmReset(false); }}>
              {t('Yes, wipe')}
            </PixelButton>
            <PixelButton size="xs" variant="ghost" onClick={() => setConfirmReset(false)}>
              {t('Cancel')}
            </PixelButton>
          </div>
        )}
      </section>

      <p className="text-[15px] leading-tight text-dim">
        {t('Simulation')}:{' '}
        {inMenu ? t('paused on the title screen') : loopMode === 'worker' ? t('Web Worker (off-thread)') : loopMode === 'main-thread' ? t('main-thread fallback') : t('starting…')} ·{' '}
        {t('Farm founded {date}', { date: formatDate(createdAt) })}
      </p>
    </div>
  );
}
