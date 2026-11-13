import { AlertTriangle, BadgeCheck, Cloud, CloudDownload, CloudUpload, CreditCard, KeyRound, LogOut, MailCheck, Send, Server, UserPlus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useGameShallow } from '../../store/useGameStore';
import { useAccountStore } from '../../store/useAccountStore';
import type { CloudSaveMeta, Plan } from '../../services/cloudApi';
import { useT } from '../../i18n';
import { cn } from '../../utils/cn';
import { formatCash, formatClock, formatDate, formatDateTime, formatDuration, formatMoney } from '../../utils/formatters';
import { PixelButton } from '../ui/PixelButton';

const money = formatMoney;
const when = (ms: number | null) => (ms ? formatDateTime(ms) : '—');

function SaveSummaryCard({ title, meta }: { title: string; meta: CloudSaveMeta | null }) {
  const t = useT();
  return (
    <div className="flex-1 bg-panel p-2 text-[15px] leading-tight">
      <div className="font-silk text-[9px] text-dim">{title}</div>
      {meta ? (
        <>
          <div className="text-gold">{t('{cash} lifetime', { cash: formatCash(meta.summary.lifetimeEarnings) })}</div>
          <div>{t('{time} played · {n} halvings', { time: formatDuration(meta.summary.playTimeSec), n: meta.summary.halvings })}</div>
          <div className="text-dim">{t('rev {n}', { n: meta.revision })} · {when(meta.updatedAt)}</div>
        </>
      ) : (
        <div className="text-dim">{t('No data')}</div>
      )}
    </div>
  );
}

/** Shown after sign-up (or a login blocked by an unconfirmed email): the link arrives by email. */
function CheckEmail() {
  const t = useT();
  const email = useAccountStore((s) => s.pendingEmail);
  const devLink = useAccountStore((s) => s.devLink);
  const busy = useAccountStore((s) => s.busy);
  const { resendVerification, setAuthView } = useAccountStore.getState();
  return (
    <div className="flex flex-col gap-2 bg-panel-2 p-3" data-testid="check-email">
      <h3 className="flex items-center gap-2 font-pixel text-[9px] text-neon">
        <MailCheck size={13} /> {t('CHECK YOUR EMAIL')}
      </h3>
      <p className="text-[16px] leading-tight">{t('We sent a confirmation link to {email}. Open it to activate your account; it works once and expires in 24 hours.', { email: email ?? '' })}</p>
      <p className="text-[15px] leading-tight text-dim">{t('Already registered with this address? The email says so instead. Nothing arrived? Check spam, or ask for a new link.')}</p>
      {devLink && (
        <a className="break-all text-[15px] leading-tight text-amber underline" href={devLink} data-testid="dev-link">
          {t('Dev server: open the link directly')}
        </a>
      )}
      <div className="flex flex-wrap gap-1">
        <PixelButton size="xs" variant="primary" icon={<Send size={10} />} disabled={busy} onClick={() => void resendVerification()}>
          {busy ? t('Connecting…') : t('Resend verification')}
        </PixelButton>
        <PixelButton size="xs" variant="ghost" onClick={() => setAuthView('login')}>
          {t('Back to log in')}
        </PixelButton>
      </div>
    </div>
  );
}

function ForgotForm() {
  const t = useT();
  const [email, setEmail] = useState(() => useAccountStore.getState().pendingEmail ?? '');
  const [localError, setLocalError] = useState<string | null>(null);
  const busy = useAccountStore((s) => s.busy);
  const { forgotPassword, setAuthView } = useAccountStore.getState();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    if (!email.trim()) {
      setLocalError(t('Enter your email.'));
      return;
    }
    await forgotPassword(email);
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2 bg-panel-2 p-3" data-testid="forgot-form">
      <h3 className="flex items-center gap-2 font-pixel text-[9px] text-neon">
        <KeyRound size={13} /> {t('RESET PASSWORD')}
      </h3>
      <p className="text-[15px] leading-tight text-dim">{t('Enter your account email and we will send you a link to choose a new password.')}</p>
      <label className="flex flex-col gap-0.5 text-[16px]">
        <span className="font-silk text-[9px] text-dim">{t('EMAIL')}</span>
        <input className="retro-input" type="text" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      {localError && <p className="text-[16px] text-hot">{localError}</p>}
      <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      <div className="flex flex-wrap gap-1">
        <PixelButton variant="success" icon={<Send size={12} />} disabled={busy} onClick={(e) => void submit(e as unknown as FormEvent)}>
          {busy ? t('Connecting…') : t('Send reset link')}
        </PixelButton>
        <PixelButton variant="ghost" onClick={() => setAuthView('login')}>
          {t('Back to log in')}
        </PixelButton>
      </div>
    </form>
  );
}

function ForgotSent() {
  const t = useT();
  const email = useAccountStore((s) => s.pendingEmail);
  const devLink = useAccountStore((s) => s.devLink);
  const { setAuthView } = useAccountStore.getState();
  return (
    <div className="flex flex-col gap-2 bg-panel-2 p-3" data-testid="forgot-sent">
      <h3 className="flex items-center gap-2 font-pixel text-[9px] text-neon">
        <MailCheck size={13} /> {t('CHECK YOUR EMAIL')}
      </h3>
      <p className="text-[16px] leading-tight">{t('If an account exists for {email}, a reset link is on its way. It works once and expires in 1 hour.', { email: email ?? '' })}</p>
      {devLink && (
        <a className="break-all text-[15px] leading-tight text-amber underline" href={devLink} data-testid="dev-link">
          {t('Dev server: open the link directly')}
        </a>
      )}
      <div className="flex gap-1">
        <PixelButton size="xs" variant="primary" onClick={() => setAuthView('login')}>
          {t('Back to log in')}
        </PixelButton>
      </div>
    </div>
  );
}

function ResetForm() {
  const t = useT();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const busy = useAccountStore((s) => s.busy);
  const { resetPassword, setAuthView } = useAccountStore.getState();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    if (password.length < 8) {
      setLocalError(t('Password must be at least 8 characters.'));
      return;
    }
    if (password !== confirm) {
      setLocalError(t('Passwords do not match.'));
      return;
    }
    await resetPassword(password);
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2 bg-panel-2 p-3" data-testid="reset-form">
      <h3 className="flex items-center gap-2 font-pixel text-[9px] text-neon">
        <KeyRound size={13} /> {t('CHOOSE A NEW PASSWORD')}
      </h3>
      <p className="text-[15px] leading-tight text-dim">{t('Saving it signs you out of every device.')}</p>
      <label className="flex flex-col gap-0.5 text-[16px]">
        <span className="font-silk text-[9px] text-dim">{t('NEW PASSWORD')}</span>
        <input className="retro-input" type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
      </label>
      <label className="flex flex-col gap-0.5 text-[16px]">
        <span className="font-silk text-[9px] text-dim">{t('CONFIRM PASSWORD')}</span>
        <input className="retro-input" type="password" autoComplete="new-password" minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      </label>
      {localError && <p className="text-[16px] text-hot">{localError}</p>}
      <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      <div className="flex flex-wrap gap-1">
        <PixelButton variant="success" icon={<KeyRound size={12} />} disabled={busy} onClick={(e) => void submit(e as unknown as FormEvent)}>
          {busy ? t('Connecting…') : t('Save new password')}
        </PixelButton>
        <PixelButton variant="ghost" onClick={() => setAuthView('login')}>
          {t('Cancel')}
        </PixelButton>
      </div>
    </form>
  );
}

function AuthForm() {
  const t = useT();
  const view = useAccountStore((s) => s.authView);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const { login, register, setAuthView } = useAccountStore.getState();
  const isBusy = useAccountStore((s) => s.busy);

  if (view === 'verifying') {
    return (
      <div className="flex items-center gap-2 bg-panel-2 p-3 text-[16px]" data-testid="verifying">
        <MailCheck size={14} className="text-neon" /> {t('Confirming your email…')}
      </div>
    );
  }
  if (view === 'check-email') return <CheckEmail />;
  if (view === 'forgot') return <ForgotForm />;
  if (view === 'forgot-sent') return <ForgotSent />;
  if (view === 'reset') return <ResetForm />;
  const mode = view;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    if (!email.trim()) {
      setLocalError(t('Enter your email.'));
      return;
    }
    // The length rule is for new passwords; an existing account logs in with whatever it has.
    if (mode === 'register' ? password.length < 8 : !password) {
      setLocalError(mode === 'register' ? t('Password must be at least 8 characters.') : t('Enter your password.'));
      return;
    }
    if (mode === 'register' && password !== confirm) {
      setLocalError(t('Passwords do not match.'));
      return;
    }
    if (mode === 'login') await login(email, password);
    else await register(email, password);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 bg-panel-2 p-3">
      <div className="flex gap-1">
        {(['login', 'register'] as const).map((m) => (
          <PixelButton key={m} size="xs" variant={mode === m ? 'primary' : 'secondary'} onClick={() => { setAuthView(m); setLocalError(null); }} silent>
            {m === 'login' ? t('Log in') : t('Create account')}
          </PixelButton>
        ))}
      </div>
      <label className="flex flex-col gap-0.5 text-[16px]">
        <span className="font-silk text-[9px] text-dim">{t('EMAIL')}</span>
        <input className="retro-input" type="text" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label className="flex flex-col gap-0.5 text-[16px]">
        <span className="font-silk text-[9px] text-dim">{t('PASSWORD')}</span>
        <input
          className="retro-input"
          type="password"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          minLength={mode === 'login' ? undefined : 8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </label>
      {mode === 'register' && (
        <label className="flex flex-col gap-0.5 text-[16px]">
          <span className="font-silk text-[9px] text-dim">{t('CONFIRM PASSWORD')}</span>
          <input className="retro-input" type="password" autoComplete="new-password" minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </label>
      )}
      {localError && <p className="text-[16px] text-hot">{localError}</p>}
      <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      <PixelButton
        variant="success"
        icon={mode === 'login' ? <KeyRound size={12} /> : <UserPlus size={12} />}
        disabled={isBusy}
        onClick={(e) => void submit(e as unknown as FormEvent)}
      >
        {isBusy ? t('Connecting…') : mode === 'login' ? t('Log in') : t('Create account')}
      </PixelButton>
      {mode === 'login' && (
        <button type="button" className="self-start text-[16px] text-neon underline" onClick={() => setAuthView('forgot')}>
          {t('Forgot password?')}
        </button>
      )}
      <p className="text-[15px] leading-tight text-dim">{t('Free account. A Miner Pass subscription unlocks cloud saves so your farm follows you to any device.')}</p>
    </form>
  );
}

function PlanCard({ plan, onPick, disabled, best }: { plan: Plan; onPick: () => void; disabled: boolean; best?: boolean }) {
  const t = useT();
  return (
    <div className={cn('flex flex-col gap-1 p-2', best ? 'bg-[#1f1503] shadow-[inset_0_0_0_2px_#facc15]' : 'bg-panel-2 shadow-[inset_0_0_0_2px_#3a3470]')}>
      <div className="flex items-center justify-between">
        <span className={cn('font-pixel text-[9px]', best ? 'gold-shimmer' : 'text-neon')}>{t(plan.name)}</span>
        {best && <span className="font-pixel text-[7px] text-gold">{t('BEST VALUE')}</span>}
      </div>
      <div className="font-pixel text-[13px] text-ink">
        {money(plan.priceCents, plan.currency)}
        <span className="font-term text-[16px] text-dim"> / {plan.interval === 'year' ? t('year') : t('month')}</span>
      </div>
      <ul className="text-[15px] leading-tight text-ink/85">
        {plan.perks.map((p) => (
          <li key={p}>▸ {t(p)}</li>
        ))}
      </ul>
      <PixelButton size="sm" variant={best ? 'gold' : 'primary'} icon={<CreditCard size={11} />} disabled={disabled} onClick={onPick}>
        {t('Subscribe')}
      </PixelButton>
    </div>
  );
}

export function AccountPanel() {
  const t = useT();
  const s = useAccountStore();
  const playTime = useGameShallow((g) => g.stats.playTimeSec);
  const [confirmLoad, setConfirmLoad] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletePw, setDeletePw] = useState('');

  if (s.serverUp === false) {
    return (
      <div className="flex flex-col gap-2 bg-panel-2 p-3 text-[17px] leading-tight">
        <span className="flex items-center gap-2 font-pixel text-[9px] text-amber">
          <Server size={14} /> {t('ACCOUNT SERVER OFFLINE')}
        </span>
        <p className="text-dim">
          {t('Your progress keeps saving locally. Start the account server with')} <code className="text-neon">npm run server</code> {t('and retry.')}
        </p>
        <PixelButton size="sm" variant="primary" onClick={() => void s.init()}>
          {t('Retry')}
        </PixelButton>
      </div>
    );
  }

  const sub = s.user?.subscription;
  return (
    <div className="flex flex-col gap-3 text-[17px]">
      {s.devBilling && (
        <div className="flex items-start gap-2 bg-[#2a1f05] p-2 text-[15px] leading-tight text-amber shadow-[inset_0_0_0_2px_#a16207]">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          {t('Demo billing: the server has no Stripe keys, so subscribing activates instantly without charging. Set STRIPE_* env vars for real payments.')}
        </div>
      )}
      {s.error && <p className="bg-[#3b0a14] px-2 py-1 text-[16px] text-hot">{s.error}</p>}
      {s.notice && <p className="bg-[#14290a] px-2 py-1 text-[16px] text-lime">{s.notice}</p>}

      {!s.user ? (
        <AuthForm />
      ) : (
        <>
          <section className="flex items-center gap-2 bg-panel-2 p-2">
            <div className="grid size-9 place-items-center bg-[#0e7490] font-pixel text-[12px] text-white">{s.user.email[0]?.toUpperCase()}</div>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate">{s.user.email}</div>
              <div className="text-[15px] text-dim">{t('Member since {date}', { date: formatDate(s.user.createdAt) })}</div>
            </div>
            <PixelButton size="xs" variant="ghost" icon={<LogOut size={10} />} onClick={() => void s.logout()}>
              {t('Log out')}
            </PixelButton>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="flex items-center gap-2 font-pixel text-[9px] text-gold">
              <BadgeCheck size={13} /> {t('MINER PASS')}
            </h3>
            {sub?.active ? (
              <div className="flex flex-col gap-1 bg-[#1f1503] p-2 leading-tight shadow-[inset_0_0_0_2px_#facc15]">
                <span className="gold-shimmer font-pixel text-[10px]">● {t('ACTIVE')} · {sub.plan === 'yearly' ? t('YEARLY') : sub.plan === 'monthly' ? t('MONTHLY') : ''}</span>
                <span className="text-[16px] text-amber/90">
                  {sub.cancelAtPeriodEnd
                    ? t('Ends on {date}', { date: sub.periodEnd ? formatDate(sub.periodEnd) : '—' })
                    : t('Renews on {date}', { date: sub.periodEnd ? formatDate(sub.periodEnd) : '—' })}
                </span>
                {!sub.cancelAtPeriodEnd && (
                  <PixelButton size="xs" variant="secondary" disabled={s.busy} onClick={() => void s.manageBilling()}>
                    {s.devBilling ? t('Cancel at period end') : t('Manage billing')}
                  </PixelButton>
                )}
              </div>
            ) : (
              <>
                {sub && sub.status !== 'none' && <p className="text-[16px] text-dim">{t('Status: {status}. Your cloud save stays downloadable; renew to keep saving.', { status: sub.status })}</p>}
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                  {s.plans.map((p) => (
                    <PlanCard key={p.id} plan={p} best={p.interval === 'year'} disabled={s.busy} onPick={() => void s.subscribe(p.id)} />
                  ))}
                </div>
              </>
            )}
          </section>

          <section className="flex flex-col gap-2 bg-panel-2 p-2">
            <h3 className="flex items-center gap-2 font-pixel text-[9px] text-neon">
              <Cloud size={13} /> {t('CLOUD SAVE')}
              <span className={cn('ml-auto font-term text-[15px]', s.syncState === 'error' && 'text-hot', s.syncState === 'conflict' && 'blink text-amber', s.syncState === 'ok' && 'text-lime')}>
                {s.syncState === 'syncing'
                  ? t('syncing…')
                  : s.syncState === 'ok'
                    ? t('synced {time}', { time: s.lastSyncAt ? formatClock(s.lastSyncAt) : '' })
                    : s.syncState === 'error'
                      ? t('error')
                      : s.syncState === 'conflict'
                        ? t('conflict')
                        : t('idle')}
              </span>
            </h3>

            {s.conflict ? (
              <div className="flex flex-col gap-2 bg-[#2a1f05] p-2 shadow-[inset_0_0_0_2px_#fbbf24]">
                <p className="text-[16px] leading-tight text-amber">{t('This device and the cloud have different progress. Which one do you keep? The other is overwritten.')}</p>
                <div className="flex gap-2">
                  <SaveSummaryCard title={t('CLOUD')} meta={s.conflict} />
                  <div className="flex-1 bg-panel p-2 text-[15px] leading-tight">
                    <div className="font-silk text-[9px] text-dim">{t('THIS DEVICE')}</div>
                    <div>{t('{time} played', { time: formatDuration(playTime) })}</div>
                    <div className="text-dim">{t('current session')}</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  <PixelButton size="xs" variant="primary" disabled={s.busy} onClick={() => void s.resolveConflict('cloud')}>
                    {t('Keep cloud')}
                  </PixelButton>
                  <PixelButton size="xs" variant="gold" disabled={s.busy} onClick={() => void s.resolveConflict('local')}>
                    {t('Keep this device')}
                  </PixelButton>
                </div>
              </div>
            ) : (
              <SaveSummaryCard title={t('LATEST CLOUD SAVE')} meta={s.cloud} />
            )}

            <div className="flex flex-wrap gap-1">
              <PixelButton size="xs" variant="success" icon={<CloudUpload size={10} />} disabled={!sub?.active || s.syncState === 'syncing' || !!s.conflict} onClick={() => void s.uploadSave()}>
                {t('Save to cloud')}
              </PixelButton>
              {!confirmLoad ? (
                <PixelButton size="xs" icon={<CloudDownload size={10} />} disabled={!s.cloud || s.busy} onClick={() => setConfirmLoad(true)}>
                  {t('Load from cloud')}
                </PixelButton>
              ) : (
                <>
                  <PixelButton size="xs" variant="danger" onClick={() => { setConfirmLoad(false); void s.downloadSave(); }}>
                    {t('Replace local progress')}
                  </PixelButton>
                  <PixelButton size="xs" variant="ghost" onClick={() => setConfirmLoad(false)}>
                    {t('Cancel')}
                  </PixelButton>
                </>
              )}
            </div>
            <label className={cn('flex items-center gap-2 text-[16px]', !sub?.active && 'opacity-50')}>
              <input type="checkbox" checked={s.autoSync} disabled={!sub?.active} onChange={(e) => s.setAutoSync(e.target.checked)} />
              {t('Auto-sync every 3 min and when you leave the tab')}
            </label>
            {!sub?.active && <p className="text-[15px] leading-tight text-dim">{t('Uploading needs an active Miner Pass. Downloading an existing cloud save is always free.')}</p>}
          </section>

          <section className="flex flex-col gap-1 bg-panel-2 p-2">
            {!deleting ? (
              <PixelButton size="xs" variant="danger" onClick={() => setDeleting(true)}>
                {t('Delete account')}
              </PixelButton>
            ) : (
              <div className="flex flex-wrap items-center gap-1">
                <input className="retro-input w-40" type="password" placeholder={t('Password')} value={deletePw} onChange={(e) => setDeletePw(e.target.value)} aria-label={t('Confirm password')} />
                <PixelButton size="xs" variant="danger" disabled={deletePw.length < 8 || s.busy} onClick={() => void s.deleteAccount(deletePw).then((ok) => ok && setDeleting(false))}>
                  {t('Delete forever')}
                </PixelButton>
                <PixelButton size="xs" variant="ghost" onClick={() => { setDeleting(false); setDeletePw(''); }}>
                  {t('Cancel')}
                </PixelButton>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
