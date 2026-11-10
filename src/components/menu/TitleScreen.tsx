import { AlertTriangle, BookOpen, CloudDownload, LogIn, Play, Settings, Sparkles, UserRound } from 'lucide-react';
import { lazy, Suspense, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { SAVE_VERSION, levelFromEarnings } from '../../config/gameBalance';
import { loadCloudAndPlay, shouldOfferCloudLoad, startFreshRun } from '../../store/session';
import { useAccountStore } from '../../store/useAccountStore';
import { hasProgress, useGameShallow, useGameStore } from '../../store/useGameStore';
import { bnToNumber } from '../../utils/bignum';
import { useT } from '../../i18n';
import { cn } from '../../utils/cn';
import { formatAgo, formatCash, formatDuration } from '../../utils/formatters';
import { AccountPanel } from '../account/AccountPanel';
import { SettingsPanel } from '../panels/SettingsPanel';
import { PixelButton } from '../ui/PixelButton';
import { PixelModal } from '../ui/PixelModal';

/** Canvas skyline + logo: split into its own chunk so the game bundle does not wait for it. */
const TitleBackdrop = lazy(() => import('./TitleBackdrop'));

type Dialog = 'settings' | 'account' | 'confirm-new' | 'confirm-cloud' | null;

function SummaryRow({ label, value, color }: { label: string; value: ReactNode; color?: string }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-2">
      <span className="shrink-0 font-silk text-[9px] uppercase text-dim">{label}</span>
      <span className="truncate text-right text-[18px] leading-none" style={{ color }}>
        {value}
      </span>
    </div>
  );
}

/** Up/Down arrows move focus between the menu buttons (Tab / Shift+Tab still work). */
function onMenuArrows(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
  if (!buttons.length) return;
  e.preventDefault();
  const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const next = e.key === 'ArrowDown' ? (i + 1) % buttons.length : (i - 1 + buttons.length) % buttons.length;
  buttons[i < 0 ? 0 : next].focus();
}

/**
 * Title screen / main menu shown on every launch. The simulation is paused
 * while it is up (useGameLoop only runs on the game screen), so no offline time
 * is credited until the player presses Continue.
 */
export function TitleScreen() {
  const t = useT();
  const save = useGameShallow((s) => ({
    cash: s.cash,
    playTimeSec: s.stats.playTimeSec,
    lastTick: s.lastTick,
    lifetime: s.lifetimeEarnings,
    progress: hasProgress(s),
  }));
  const { continueGame, setWikiOpen } = useGameStore.getState();
  const account = useAccountStore(
    useShallow((a) => ({
      signedIn: !!a.token,
      email: a.user?.email ?? null,
      guest: a.guest,
      cloud: a.cloud,
      cloudOffer: !!a.user && shouldOfferCloudLoad(a),
      busy: a.busy,
      error: a.error,
      serverUp: a.serverUp,
      linkOutcome: a.linkOutcome,
    })),
  );
  const playAsGuest = useAccountStore((a) => a.playAsGuest);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Signing in from the Account window brings the player back to the menu (and its cloud offer).
  const wasSignedIn = useRef(!!account.email);
  useEffect(() => {
    // ...except after opening an email link, where the dialog is what shows the result.
    if (account.email && !wasSignedIn.current && dialog === 'account' && !account.linkOutcome) setDialog(null);
    wasSignedIn.current = !!account.email;
  }, [account.email, account.linkOutcome, dialog]);

  // A `?verify=` / `?reset=` link opens the Account dialog straight away.
  useEffect(() => {
    if (account.linkOutcome) setDialog('account');
  }, [account.linkOutcome]);

  const needsIdentity = !account.guest && !account.signedIn;
  const level = levelFromEarnings(bnToNumber(save.lifetime));
  const dismissLink = useAccountStore((a) => a.dismissLink);
  const close = () => {
    setDialog(null);
    dismissLink();
  };

  const loadCloud = async () => {
    setDialog(null);
    setCloudBusy(true);
    await loadCloudAndPlay();
    setCloudBusy(false);
  };

  return (
    <div className="relative isolate min-h-full w-full overflow-hidden" data-testid="title-screen">
      {/* Full-bleed animated backdrop (absolute, behind the panel); it also draws the logo. */}
      <Suspense fallback={<div className="absolute inset-0 bg-void" aria-hidden="true" />}>
        <TitleBackdrop />
      </Suspense>

      {/* The logo fills the top ~5-35% of the backdrop: the panel sits just below center. */}
      <div className="relative z-10 mx-auto flex min-h-full w-full max-w-lg flex-col items-center gap-4 px-3 pb-6 pt-[max(37vh,150px)]">
        <h1 className="sr-only">Hash Harvest Tycoon</h1>

        <section className="pixel-box w-full p-3 sm:p-4" aria-label={t('Main menu')} onKeyDown={onMenuArrows}>
          {needsIdentity ? (
            <div className="flex flex-col gap-2" data-testid="menu-identity">
              <h2 className="text-center font-pixel text-[10px] text-neon">{t("WHO'S MINING?")}</h2>
              <PixelButton size="lg" variant="primary" icon={<LogIn size={14} />} onClick={() => setDialog('account')} autoFocus className="w-full">
                {t('Sign in / Create account')}
              </PixelButton>
              <PixelButton size="lg" variant="secondary" icon={<UserRound size={14} />} onClick={playAsGuest} className="w-full">
                {t('Play as guest')}
              </PixelButton>
              <p className="text-center text-[16px] leading-tight text-dim">{t('Guest progress is saved only in this browser.')}</p>
              {account.serverUp === false && (
                <p className="flex items-center justify-center gap-1 text-center text-[15px] leading-tight text-amber">
                  <AlertTriangle size={12} className="shrink-0" /> {t('Account server offline: guest play still works.')}
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2" data-testid="menu-main">
              {save.progress && (
                <div className="flex flex-col gap-2 bg-panel-2 p-2 shadow-[inset_0_0_0_2px_#3f6212]">
                  <PixelButton size="lg" variant="success" icon={<Play size={14} />} onClick={continueGame} autoFocus className="w-full">
                    {t('Continue')}
                  </PixelButton>
                  <div className="grid grid-cols-1 gap-x-3 gap-y-1 px-1 min-[360px]:grid-cols-2" data-testid="continue-summary">
                    <SummaryRow label={t('Cash')} value={formatCash(save.cash)} color="#facc15" />
                    <SummaryRow label={t('Level')} value={`LV ${level}`} color="#fbbf24" />
                    <SummaryRow label={t('Played')} value={formatDuration(save.playTimeSec)} />
                    <SummaryRow label={t('Last played')} value={formatAgo(save.lastTick, now)} color="#8f89c4" />
                  </div>
                </div>
              )}

              <PixelButton
                size="lg"
                variant={save.progress ? 'secondary' : 'primary'}
                icon={<Sparkles size={14} />}
                onClick={() => (save.progress ? setDialog('confirm-new') : startFreshRun())}
                autoFocus={!save.progress}
                className="w-full"
              >
                {t('New game')}
              </PixelButton>

              {account.cloudOffer && account.cloud && (
                <div className="flex flex-col gap-1 bg-panel-2 p-2 shadow-[inset_0_0_0_2px_#0e7490]" data-testid="cloud-offer">
                  <div className="flex items-center gap-2 font-pixel text-[8px] text-neon">
                    <CloudDownload size={12} /> {t('CLOUD SAVE FOUND')}
                  </div>
                  <p className="text-[16px] leading-tight text-ink/85">
                    {t('{cash} lifetime · {time} played · saved {ago}', {
                      cash: formatCash(account.cloud.summary.lifetimeEarnings),
                      time: formatDuration(account.cloud.summary.playTimeSec),
                      ago: formatAgo(account.cloud.updatedAt, now),
                    })}
                  </p>
                  <PixelButton
                    size="md"
                    variant="primary"
                    icon={<CloudDownload size={12} />}
                    disabled={account.busy || cloudBusy}
                    onClick={() => (save.progress ? setDialog('confirm-cloud') : void loadCloud())}
                    className="w-full"
                  >
                    {cloudBusy ? t('Loading…') : t('Load cloud save')}
                  </PixelButton>
                  {account.error && <p className="text-[15px] leading-tight text-hot">{account.error}</p>}
                </div>
              )}
            </div>
          )}

          <div className={cn('mt-3 grid grid-cols-1 gap-1 border-t-2 border-[#1b1838] pt-3', needsIdentity ? 'min-[400px]:grid-cols-2' : 'min-[400px]:grid-cols-3')}>
            <PixelButton size="sm" icon={<Settings size={12} />} onClick={() => setDialog('settings')}>
              {t('Settings')}
            </PixelButton>
            <PixelButton size="sm" icon={<BookOpen size={12} />} onClick={() => setWikiOpen(true)}>
              {t('How to play')}
            </PixelButton>
            {!needsIdentity && (
              <PixelButton size="sm" icon={account.signedIn ? <UserRound size={12} /> : <LogIn size={12} />} onClick={() => setDialog('account')}>
                {account.signedIn ? t('Account') : t('Sign in')}
              </PixelButton>
            )}
          </div>

          {!needsIdentity && (
            <p className="mt-2 truncate text-center text-[15px] leading-tight text-dim" data-testid="menu-identity-status">
              {account.signedIn ? (
                <>
                  {t('Signed in as')} <span className="text-neon">{account.email ?? '…'}</span>
                </>
              ) : (
                t('Playing as guest: progress is saved only in this browser.')
              )}
            </p>
          )}
        </section>

        <footer className="bg-void/75 px-2 py-1 text-center font-silk text-[9px] leading-relaxed text-dim">
          <div className="blink text-lime">▶ {t('PRESS ENTER TO SELECT')}</div>
          <div>{t('↑ ↓ OR TAB TO MOVE')} · {t('SAVE')} V{SAVE_VERSION}</div>
        </footer>
      </div>

      {dialog === 'settings' && (
        <PixelModal title={t('Settings')} onClose={close} className="max-w-xl" accent="#a5b4fc">
          <SettingsPanel loopMode={null} inMenu />
        </PixelModal>
      )}
      {dialog === 'account' && (
        <PixelModal title={t('Account')} onClose={close} className="max-w-xl" accent="#38bdf8">
          <AccountPanel />
        </PixelModal>
      )}
      {dialog === 'confirm-new' && (
        <PixelModal title={t('Start a new game?')} onClose={close} className="max-w-md" accent="#f43f5e">
          <div className="flex flex-col gap-3 text-[18px] leading-tight">
            <p className="flex gap-2 text-hot">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              {t('Your local progress will be overwritten: {cash} cash, LV {level}, {time} played. This cannot be undone.', {
                cash: formatCash(save.cash),
                level,
                time: formatDuration(save.playTimeSec),
              })}
            </p>
            <p className="text-dim">{t('Want a backup? Export your save from Settings first.')}</p>
            <p className="text-dim">{t('A cloud save, if you are signed in, is separate: it is not deleted, and the next sync asks which progress to keep.')}</p>
            <div className="flex flex-wrap justify-end gap-2">
              <PixelButton variant="ghost" onClick={close} autoFocus>
                {t('Cancel')}
              </PixelButton>
              <PixelButton
                variant="danger"
                icon={<Sparkles size={12} />}
                onClick={() => {
                  setDialog(null);
                  startFreshRun();
                }}
              >
                {t('Overwrite & start')}
              </PixelButton>
            </div>
          </div>
        </PixelModal>
      )}
      {dialog === 'confirm-cloud' && (
        <PixelModal title={t('Load cloud save?')} onClose={close} className="max-w-md" accent="#22d3ee">
          <div className="flex flex-col gap-3 text-[18px] leading-tight">
            <p className="text-amber">{t('The cloud save replaces the progress stored in this browser ({cash} cash, {time} played).', { cash: formatCash(save.cash), time: formatDuration(save.playTimeSec) })}</p>
            <div className="flex flex-wrap justify-end gap-2">
              <PixelButton variant="ghost" onClick={close} autoFocus>
                {t('Cancel')}
              </PixelButton>
              <PixelButton variant="primary" icon={<CloudDownload size={12} />} onClick={() => void loadCloud()}>
                {t('Replace & play')}
              </PixelButton>
            </div>
          </div>
        </PixelModal>
      )}
    </div>
  );
}
