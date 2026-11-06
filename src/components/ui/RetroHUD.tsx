import { CircleHelp, Cloud, CloudOff, Coins, Cpu, Gem, Pickaxe, ScrollText, Thermometer, Volume2, VolumeX, Zap } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NETWORK_EVENTS, POOLS, earningsForLevel, levelFromEarnings } from '../../config/gameBalance';
import { talentModifiers } from '../../config/prestigeTree';
import { ROOM_BY_ID } from '../../config/roomsCatalog';
import { useShallow } from 'zustand/react/shallow';
import { wattPrice } from '../../store/gamePhysics';
import { useAccountStore } from '../../store/useAccountStore';
import { useGameShallow, useGameStore } from '../../store/useGameStore';
import { useT } from '../../i18n';
import { bnToNumber } from '../../utils/bignum';
import { fxBus } from '../../utils/eventBus';
import { formatCash, formatHashrate, formatMultiplier, formatNumber, formatPower, formatPrice, formatTemp, tempColor } from '../../utils/formatters';
import { Meter } from './Meter';
import { PixelButton } from './PixelButton';

function Stat({ icon, label, value, sub, color, glow }: { icon: ReactNode; label: string; value: string; sub?: ReactNode; color: string; glow?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="grid size-8 shrink-0 place-items-center" style={{ background: `${color}22`, color, boxShadow: `inset 0 0 0 2px ${color}55` }}>
        {icon}
      </div>
      <div className="min-w-0 leading-none">
        <div className="font-silk text-[10px] uppercase text-dim">{label}</div>
        <div className={`truncate font-pixel text-[11px] ${glow ? 'text-glow' : ''}`} style={{ color }}>
          {value}
        </div>
        {sub && <div className="mt-0.5 truncate text-[15px] leading-none text-dim">{sub}</div>}
      </div>
    </div>
  );
}

/** Top status bar: wallets, hashrate, power & thermals of the active room, events. */
export function RetroHUD() {
  const t = useT();
  const s = useGameShallow((st) => ({
    cash: st.cash,
    cc: st.cc,
    meme: st.meme,
    gems: st.gems,
    sc: st.sc,
    price: st.market.CC.price,
    open: st.market.CC.candles[st.market.CC.candles.length - 12]?.c ?? st.market.CC.price,
    memePrice: st.market.MEME.price,
    totalHash: st.live.totalHash,
    ccPerSec: st.live.ccPerSec,
    elec: st.live.electricityPerSec,
    grid: st.live.gridDemand,
    elecMul: talentModifiers(st.talents).electricityMul,
    hottest: st.live.hottest,
    room: st.live.rooms[st.activeRoom],
    activeRoom: st.activeRoom,
    pool: st.pool,
    event: st.event,
    lifetime: st.lifetimeEarnings,
    muted: st.settings.muted,
  }));
  const updateSettings = useGameStore((st) => st.updateSettings);
  const sellCoin = useGameStore((st) => st.sellCoin);
  const setSideTab = useGameStore((st) => st.setSideTab);
  const setWikiOpen = useGameStore((st) => st.setWikiOpen);
  const account = useAccountStore(useShallow((a) => ({ email: a.user?.email ?? null, active: !!a.user?.subscription.active, sync: a.syncState })));
  const [now, setNow] = useState(() => Date.now());
  const [pops, setPops] = useState<{ id: number; text: string }[]>([]);
  const popId = useRef(0);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    const off = fxBus.on((fx) => {
      if (fx.kind !== 'sell') return;
      popId.current += 1;
      const id = popId.current;
      setPops((p) => [...p.slice(-3), { id, text: `+${formatCash(fx.amount)}` }]);
      setTimeout(() => setPops((p) => p.filter((x) => x.id !== id)), 1200);
    });
    return () => {
      clearInterval(timer);
      off();
    };
  }, []);

  const lifetime = bnToNumber(s.lifetime);
  const level = levelFromEarnings(lifetime);
  const lvlFrom = earningsForLevel(level);
  const lvlTo = earningsForLevel(level + 1);
  const lvlProgress = Math.max(0, Math.min(1, (Math.log10(Math.max(1, lifetime)) - Math.log10(lvlFrom)) / (Math.log10(lvlTo) - Math.log10(lvlFrom))));
  const change = s.open > 0 ? s.price / s.open - 1 : 0;
  const room = ROOM_BY_ID[s.activeRoom];
  const ccValue = bnToNumber(s.cc) * s.price;
  const event = s.event ? NETWORK_EVENTS[s.event.id] : null;
  const pool = POOLS[s.pool];
  // $ per kWh actually billed in the active room at the farm's current grid demand.
  const kwhPrice = wattPrice(s.activeRoom, { electricityMul: s.elecMul }) * s.grid * 3.6e6;
  const gridTitle = t('Grid demand x{grid}: dense, high-hash rigs pay industrial demand rates. {room}: {price}/kWh. Better PSUs, cheaper rooms and Green PPA cut the bill.', {
    grid: s.grid.toFixed(s.grid < 10 ? 2 : 0),
    room: t(room.name),
    price: formatCash(kwhPrice),
  });

  return (
    <header className="pixel-box mx-2 mt-2 flex flex-col gap-2 px-3 py-2 sm:mx-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="flex items-center gap-2 pr-2">
          <div className="grid size-9 place-items-center bg-[#14532d] font-pixel text-[10px] text-lime shadow-[inset_0_0_0_2px_#a3e635]">
            ₿
          </div>
          <div className="leading-none">
            <h1 className="font-pixel text-[11px] text-ink sm:text-[13px]">
              HASH<span className="text-lime">HARVEST</span>
            </h1>
            <div className="mt-1 flex items-center gap-1.5">
              <span className="font-silk text-[10px] text-amber">LV {level}</span>
              <div className="h-1.5 w-16 bg-[#1b1838]">
                <div className="h-full bg-amber" style={{ width: `${lvlProgress * 100}%` }} />
              </div>
            </div>
          </div>
        </div>

        <div className="relative">
          <Stat
            icon={<Coins size={16} />}
            label={t('Cash')}
            value={formatCash(s.cash)}
            color="#facc15"
            glow
            sub={
              <span title={gridTitle} data-testid="hud-grid">
                {s.elec > 0 ? t('-{cost}/s power', { cost: formatCash(s.elec) }) : t('no power bill')} · <span className={s.grid >= 10 ? 'text-amber' : ''}>{t('grid {mult}', { mult: formatMultiplier(s.grid) })}</span>
              </span>
            }
          />
          {pops.map((p) => (
            <span key={p.id} className="rise-fade pointer-events-none absolute -top-1 left-10 font-pixel text-[10px] text-lime">
              {p.text}
            </span>
          ))}
        </div>
        <Stat
          icon={<Pickaxe size={16} />}
          label={t('$CC Wallet')}
          value={formatNumber(s.cc)}
          color="#22d3ee"
          sub={
            <span>
              {formatPrice(s.price)}{' '}
              <span style={{ color: change >= 0 ? '#a3e635' : '#f43f5e' }}>
                {change >= 0 ? '▲' : '▼'}
                {Math.abs(change * 100).toFixed(1)}%
              </span>{' '}
              ≈ {formatCash(ccValue)}
            </span>
          }
        />
        <Stat icon={<ScrollText size={16} />} label="$MEME" value={formatNumber(s.meme)} color="#e879f9" sub={formatPrice(s.memePrice)} />
        <Stat icon={<Cpu size={16} />} label={t('Hashrate')} value={formatHashrate(s.totalHash)} color="#a3e635" glow sub={`${formatNumber(s.ccPerSec, 3)} CC/s · ${t(pool.name).split(' ')[0]}`} />
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 font-pixel text-[10px] text-magenta" title={t('Gems')}>
            <Gem size={14} /> {s.gems}
          </span>
          <span className="font-pixel text-[10px] text-amber" title={t('Smart Contracts')}>
            {s.sc} $SC
          </span>
        </div>

        <div className="ml-auto flex items-center gap-1">
          <PixelButton
            size="sm"
            variant={account.active ? 'gold' : 'ghost'}
            onClick={() => setSideTab('account')}
            title={account.email ? t('{email} · cloud {sync}', { email: account.email, sync: account.sync }) : t('Log in to save your progress in the cloud')}
            icon={account.active ? <Cloud size={13} className={account.sync === 'syncing' ? 'blink' : ''} /> : <CloudOff size={13} />}
          >
            <span className="hidden sm:inline">{account.email ? (account.active ? t('Miner Pass') : t('Account')) : t('Log in')}</span>
          </PixelButton>
          <PixelButton size="sm" variant="primary" disabled={bnToNumber(s.cc) <= 0} onClick={() => sellCoin('CC', bnToNumber(s.cc))} title={t('Sell every $CC at market price')}>
            {t('Sell all CC')}
          </PixelButton>
          <PixelButton size="sm" variant="ghost" onClick={() => setWikiOpen(true)} aria-label={t('How to play')} title={t('How to play (wiki)')}>
            <CircleHelp size={14} />
          </PixelButton>
          <PixelButton size="sm" variant="ghost" onClick={() => updateSettings({ muted: !s.muted })} aria-label={s.muted ? t('Unmute') : t('Mute')}>
            {s.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </PixelButton>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-x-5 gap-y-2 border-t-2 border-[#1b1838] pt-2 md:grid-cols-2 2xl:grid-cols-[1fr_1fr_1.2fr]">
        <div className="flex items-center gap-2">
          <Zap size={14} className="shrink-0 text-amber" />
          <span className="w-24 shrink-0 font-silk text-[10px] uppercase text-dim">{t('{room} line', { room: t(room.name).split(' ')[0] })}</span>
          <Meter value={s.room?.wall ?? 0} max={room.maxPowerW} color="#fbbf24" className="flex-1" />
          <span className="shrink-0 whitespace-nowrap text-right text-[16px] leading-none" style={{ color: (s.room?.brownout ?? 1) < 1 ? '#f43f5e' : '#e9e6ff' }}>
            {formatPower(s.room?.wall ?? 0)}/{formatPower(room.maxPowerW)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Thermometer size={14} className="shrink-0" style={{ color: tempColor(s.hottest) }} />
          <span className="w-24 shrink-0 font-silk text-[10px] uppercase text-dim">{t('Hottest die')}</span>
          <Meter value={Math.max(0, s.hottest - 20)} max={80} color="#22c55e" warnAt={0.6} dangerAt={0.81} className="flex-1" />
          <span className="shrink-0 whitespace-nowrap text-right text-[16px] leading-none" style={{ color: tempColor(s.hottest) }}>
            {t('{temp} · air {air}', { temp: formatTemp(s.hottest), air: formatTemp(s.room?.temp ?? room.ambient) })}
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-2 overflow-hidden md:col-span-2 2xl:col-span-1">
          {event ? (
            <div className="flex min-w-0 flex-1 items-center gap-2 px-2 py-0.5" style={{ background: `${event.color}22`, boxShadow: `inset 0 0 0 2px ${event.color}88` }}>
              <span className="blink font-pixel text-[9px]" style={{ color: event.color }}>
                ⚠ {t(event.name)}
              </span>
              <span className="truncate text-[16px] leading-none text-ink/80">{t(event.description)}</span>
              <span className="ml-auto shrink-0 font-pixel text-[9px]" style={{ color: event.color }}>
                {Math.max(0, Math.ceil(((s.event?.endsAt ?? now) - now) / 1000))}s
              </span>
            </div>
          ) : (
            <div className="relative h-5 flex-1 overflow-hidden text-[16px] leading-5 text-dim">
              <span className="marquee absolute whitespace-nowrap">
                {t('NETWORK STABLE · {pool} · $CC {cc} · $MEME {meme} · KEEP DIES UNDER 85°C TO AVOID THROTTLING · OVERCLOCK IN THE BIOS FOR UP TO +40% ·', {
                  pool: t(pool.name).toUpperCase(),
                  cc: formatPrice(s.price),
                  meme: formatPrice(s.memePrice),
                })}
              </span>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
