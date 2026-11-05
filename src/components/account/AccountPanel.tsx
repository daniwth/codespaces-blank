import { AlertTriangle, BadgeCheck, Cloud, CloudDownload, CloudUpload, CreditCard, KeyRound, LogOut, Server, UserPlus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useGameShallow } from '../../store/useGameStore';
import { useAccountStore } from '../../store/useAccountStore';
import type { CloudSaveMeta, Plan } from '../../services/cloudApi';
import { cn } from '../../utils/cn';
import { formatCash, formatDuration } from '../../utils/formatters';
import { PixelButton } from '../ui/PixelButton';

const money = (cents: number, currency: string) => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
const when = (ms: number | null) => (ms ? new Date(ms).toLocaleString() : '—');

function SaveSummaryCard({ title, meta }: { title: string; meta: CloudSaveMeta | null }) {
  return (
    <div className="flex-1 bg-panel p-2 text-[15px] leading-tight">
      <div className="font-silk text-[9px] text-dim">{title}</div>
      {meta ? (
        <>
          <div className="text-gold">{formatCash(meta.summary.lifetimeEarnings)} lifetime</div>
          <div>{formatDuration(meta.summary.playTimeSec)} played · {meta.summary.halvings} halvings</div>
          <div className="text-dim">rev {meta.revision} · {when(meta.updatedAt)}</div>
        </>
      ) : (
        <div className="text-dim">No data</div>
      )}
    </div>
  );
}

function AuthForm() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const { login, register, busy, clearMessages } = useAccountStore.getState();
  const isBusy = useAccountStore((s) => s.busy) || busy;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    if (mode === 'register' && password !== confirm) {
      setLocalError('Passwords do not match.');
      return;
    }
    if (mode === 'login') await login(email, password);
    else await register(email, password);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 bg-panel-2 p-3">
      <div className="flex gap-1">
        {(['login', 'register'] as const).map((m) => (
          <PixelButton key={m} size="xs" variant={mode === m ? 'primary' : 'secondary'} onClick={() => { setMode(m); clearMessages(); setLocalError(null); }} silent>
            {m === 'login' ? 'Log in' : 'Create account'}
          </PixelButton>
        ))}
      </div>
      <label className="flex flex-col gap-0.5 text-[16px]">
        <span className="font-silk text-[9px] text-dim">EMAIL</span>
        <input className="retro-input" type="text" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label className="flex flex-col gap-0.5 text-[16px]">
        <span className="font-silk text-[9px] text-dim">PASSWORD</span>
        <input
          className="retro-input"
          type="password"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </label>
      {mode === 'register' && (
        <label className="flex flex-col gap-0.5 text-[16px]">
          <span className="font-silk text-[9px] text-dim">CONFIRM PASSWORD</span>
          <input className="retro-input" type="password" autoComplete="new-password" minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </label>
      )}
      {localError && <p className="text-[16px] text-hot">{localError}</p>}
      <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      <PixelButton
        variant="success"
        icon={mode === 'login' ? <KeyRound size={12} /> : <UserPlus size={12} />}
        disabled={isBusy || !email || password.length < 8}
        onClick={(e) => void submit(e as unknown as FormEvent)}
      >
        {isBusy ? 'Connecting…' : mode === 'login' ? 'Log in' : 'Create account'}
      </PixelButton>
      <p className="text-[15px] leading-tight text-dim">Free account. A Miner Pass subscription unlocks cloud saves so your farm follows you to any device.</p>
    </form>
  );
}

function PlanCard({ plan, onPick, disabled, best }: { plan: Plan; onPick: () => void; disabled: boolean; best?: boolean }) {
  return (
    <div className={cn('flex flex-col gap-1 p-2', best ? 'bg-[#1f1503] shadow-[inset_0_0_0_2px_#facc15]' : 'bg-panel-2 shadow-[inset_0_0_0_2px_#3a3470]')}>
      <div className="flex items-center justify-between">
        <span className={cn('font-pixel text-[9px]', best ? 'gold-shimmer' : 'text-neon')}>{plan.name}</span>
        {best && <span className="font-pixel text-[7px] text-gold">BEST VALUE</span>}
      </div>
      <div className="font-pixel text-[13px] text-ink">
        {money(plan.priceCents, plan.currency)}
        <span className="font-term text-[16px] text-dim"> / {plan.interval}</span>
      </div>
      <ul className="text-[15px] leading-tight text-ink/85">
        {plan.perks.map((p) => (
          <li key={p}>▸ {p}</li>
        ))}
      </ul>
      <PixelButton size="sm" variant={best ? 'gold' : 'primary'} icon={<CreditCard size={11} />} disabled={disabled} onClick={onPick}>
        Subscribe
      </PixelButton>
    </div>
  );
}

export function AccountPanel() {
  const s = useAccountStore();
  const playTime = useGameShallow((g) => g.stats.playTimeSec);
  const [confirmLoad, setConfirmLoad] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletePw, setDeletePw] = useState('');

  if (s.serverUp === false) {
    return (
      <div className="flex flex-col gap-2 bg-panel-2 p-3 text-[17px] leading-tight">
        <span className="flex items-center gap-2 font-pixel text-[9px] text-amber">
          <Server size={14} /> ACCOUNT SERVER OFFLINE
        </span>
        <p className="text-dim">Your progress keeps saving locally. Start the account server with <code className="text-neon">npm run server</code> and retry.</p>
        <PixelButton size="sm" variant="primary" onClick={() => void s.init()}>
          Retry
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
          Demo billing: the server has no Stripe keys, so subscribing activates instantly without charging. Set STRIPE_* env vars for real payments.
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
              <div className="text-[15px] text-dim">Member since {new Date(s.user.createdAt).toLocaleDateString()}</div>
            </div>
            <PixelButton size="xs" variant="ghost" icon={<LogOut size={10} />} onClick={() => void s.logout()}>
              Log out
            </PixelButton>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="flex items-center gap-2 font-pixel text-[9px] text-gold">
              <BadgeCheck size={13} /> MINER PASS
            </h3>
            {sub?.active ? (
              <div className="flex flex-col gap-1 bg-[#1f1503] p-2 leading-tight shadow-[inset_0_0_0_2px_#facc15]">
                <span className="gold-shimmer font-pixel text-[10px]">● ACTIVE · {sub.plan?.toUpperCase()}</span>
                <span className="text-[16px] text-amber/90">
                  {sub.cancelAtPeriodEnd ? 'Ends' : 'Renews'} on {sub.periodEnd ? new Date(sub.periodEnd).toLocaleDateString() : '—'}
                </span>
                {!sub.cancelAtPeriodEnd && (
                  <PixelButton size="xs" variant="secondary" disabled={s.busy} onClick={() => void s.manageBilling()}>
                    {s.devBilling ? 'Cancel at period end' : 'Manage billing'}
                  </PixelButton>
                )}
              </div>
            ) : (
              <>
                {sub && sub.status !== 'none' && <p className="text-[16px] text-dim">Status: {sub.status}. Your cloud save stays downloadable; renew to keep saving.</p>}
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
              <Cloud size={13} /> CLOUD SAVE
              <span className={cn('ml-auto font-term text-[15px]', s.syncState === 'error' && 'text-hot', s.syncState === 'conflict' && 'blink text-amber', s.syncState === 'ok' && 'text-lime')}>
                {s.syncState === 'syncing' ? 'syncing…' : s.syncState === 'ok' ? `synced ${s.lastSyncAt ? new Date(s.lastSyncAt).toLocaleTimeString() : ''}` : s.syncState}
              </span>
            </h3>

            {s.conflict ? (
              <div className="flex flex-col gap-2 bg-[#2a1f05] p-2 shadow-[inset_0_0_0_2px_#fbbf24]">
                <p className="text-[16px] leading-tight text-amber">This device and the cloud have different progress. Which one do you keep? The other is overwritten.</p>
                <div className="flex gap-2">
                  <SaveSummaryCard title="CLOUD" meta={s.conflict} />
                  <div className="flex-1 bg-panel p-2 text-[15px] leading-tight">
                    <div className="font-silk text-[9px] text-dim">THIS DEVICE</div>
                    <div>{formatDuration(playTime)} played</div>
                    <div className="text-dim">current session</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  <PixelButton size="xs" variant="primary" disabled={s.busy} onClick={() => void s.resolveConflict('cloud')}>
                    Keep cloud
                  </PixelButton>
                  <PixelButton size="xs" variant="gold" disabled={s.busy} onClick={() => void s.resolveConflict('local')}>
                    Keep this device
                  </PixelButton>
                </div>
              </div>
            ) : (
              <SaveSummaryCard title="LATEST CLOUD SAVE" meta={s.cloud} />
            )}

            <div className="flex flex-wrap gap-1">
              <PixelButton size="xs" variant="success" icon={<CloudUpload size={10} />} disabled={!sub?.active || s.syncState === 'syncing' || !!s.conflict} onClick={() => void s.uploadSave()}>
                Save to cloud
              </PixelButton>
              {!confirmLoad ? (
                <PixelButton size="xs" icon={<CloudDownload size={10} />} disabled={!s.cloud || s.busy} onClick={() => setConfirmLoad(true)}>
                  Load from cloud
                </PixelButton>
              ) : (
                <>
                  <PixelButton size="xs" variant="danger" onClick={() => { setConfirmLoad(false); void s.downloadSave(); }}>
                    Replace local progress
                  </PixelButton>
                  <PixelButton size="xs" variant="ghost" onClick={() => setConfirmLoad(false)}>
                    Cancel
                  </PixelButton>
                </>
              )}
            </div>
            <label className={cn('flex items-center gap-2 text-[16px]', !sub?.active && 'opacity-50')}>
              <input type="checkbox" checked={s.autoSync} disabled={!sub?.active} onChange={(e) => s.setAutoSync(e.target.checked)} />
              Auto-sync every 3 min and when you leave the tab
            </label>
            {!sub?.active && <p className="text-[15px] leading-tight text-dim">Uploading needs an active Miner Pass. Downloading an existing cloud save is always free.</p>}
          </section>

          <section className="flex flex-col gap-1 bg-panel-2 p-2">
            {!deleting ? (
              <PixelButton size="xs" variant="danger" onClick={() => setDeleting(true)}>
                Delete account
              </PixelButton>
            ) : (
              <div className="flex flex-wrap items-center gap-1">
                <input className="retro-input w-40" type="password" placeholder="Password" value={deletePw} onChange={(e) => setDeletePw(e.target.value)} aria-label="Confirm password" />
                <PixelButton size="xs" variant="danger" disabled={deletePw.length < 8 || s.busy} onClick={() => void s.deleteAccount(deletePw).then((ok) => ok && setDeleting(false))}>
                  Delete forever
                </PixelButton>
                <PixelButton size="xs" variant="ghost" onClick={() => { setDeleting(false); setDeletePw(''); }}>
                  Cancel
                </PixelButton>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
