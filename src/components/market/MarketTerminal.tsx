import { Bot, Crosshair, Newspaper, Plus, Power, Trash2, TrendingUp } from 'lucide-react';
import { MARKET_PHASES, MARKET_PHASE_IDS, NEWS, ORDERS } from '../../config/marketCycle';
import { researchModifiers } from '../../config/research';
import { useState } from 'react';
import { COIN_IDS, COIN_INFO } from '../../config/altcoins';
import { BOT_UNLOCK_LEVEL, MARKET, levelFromEarnings } from '../../config/gameBalance';
import { talentModifiers } from '../../config/prestigeTree';
import { useT } from '../../i18n';
import { sprites } from '../../engine/SpriteManager';
import { sellPrice } from '../../store/gamePhysics';
import { costBasisOf, holdingOf } from '../../store/wallets';
import { useGameShallow, useGameStore } from '../../store/useGameStore';
import type { CoinId, OrderKind, TradingBot } from '../../types/economy';
import { bnToNumber } from '../../utils/bignum';
import { cn } from '../../utils/cn';
import { formatCash, formatNumber, formatPrice } from '../../utils/formatters';
import { NumberField } from '../ui/NumberField';
import { PixelButton } from '../ui/PixelButton';
import { SpriteImg } from '../ui/SpriteImg';
import { CryptoCanvasChart } from './CryptoCanvasChart';

export function MarketTerminal() {
  const t = useT();
  const [coin, setCoin] = useState<CoinId>('CC');
  const [buyAmount, setBuyAmount] = useState('100');
  const s = useGameShallow((st) => ({
    market: st.market,
    cc: st.cc,
    ccCostBasis: st.ccCostBasis,
    meme: st.meme,
    memeCostBasis: st.memeCostBasis,
    alts: st.alts,
    minedCoin: st.minedCoin,
    cash: st.cash,
    talents: st.talents,
    bots: st.bots,
    lifetime: st.lifetimeEarnings,
    vip: st.vip,
    cycle: st.cycle,
    orders: st.orders,
    orderDesk: researchModifiers(st.research.levels).orderDesk,
  }));
  const { sellCoin, buyCoin, addBot, updateBot, removeBot, setAutoSellEnabled, addOrder, removeOrder, setSideTab } = useGameStore.getState();
  const [orderKind, setOrderKind] = useState<OrderKind>('tp');
  const [orderMul, setOrderMul] = useState(1.2);
  const [orderPct, setOrderPct] = useState(100);
  const phase = MARKET_PHASES[s.cycle.phase];
  const news = s.cycle.news ? NEWS[s.cycle.news.id] : null;
  const holding = holdingOf(s, coin);
  const mods = talentModifiers(s.talents);
  const unit = sellPrice(s.market, coin, mods);
  const value = holding * unit;
  const cash = bnToNumber(s.cash);
  const m = s.market[coin];
  const first = m.candles[0]?.o ?? m.price;
  const change = m.price / first - 1;
  const costBasis = costBasisOf(s, coin);
  const pnl = value - costBasis;
  const level = levelFromEarnings(bnToNumber(s.lifetime));
  const info = COIN_INFO[coin];

  return (
    <div className="flex flex-col gap-3">
      {/* Market cycle and news ticker */}
      <div className="flex flex-col gap-1 bg-panel-2 p-2" data-testid="market-cycle">
        <div className="flex flex-wrap items-center gap-1" role="list" aria-label={t('Market cycle')}>
          {MARKET_PHASE_IDS.map((id) => {
            const def = MARKET_PHASES[id];
            const on = id === s.cycle.phase;
            return (
              <span
                key={id}
                role="listitem"
                aria-current={on ? 'step' : undefined}
                className="px-1.5 py-0.5 font-pixel text-[8px] uppercase"
                style={on ? { background: def.color, color: '#07060f', boxShadow: `0 0 8px ${def.color}88` } : { color: def.color, background: '#141128', opacity: 0.6 }}
                data-testid={on ? 'market-phase' : undefined}
              >
                {t(def.name)}
              </span>
            );
          })}
        </div>
        <div className="text-[16px] leading-tight" style={{ color: phase.color }}>{t(phase.description)}</div>
        <div className="flex items-center gap-2 overflow-hidden bg-black/50 px-2 py-0.5 text-[16px] leading-5" aria-live="polite" data-testid="news-ticker">
          <Newspaper size={13} className={news ? 'blink shrink-0' : 'shrink-0 text-dim'} style={{ color: news ? (news.positive ? '#a3e635' : '#f43f5e') : undefined }} />
          <div className="relative h-5 min-w-0 flex-1 overflow-hidden">
            <span className={news ? 'marquee absolute whitespace-nowrap' : 'absolute whitespace-nowrap text-dim'} style={{ color: news ? (news.positive ? '#a3e635' : '#f43f5e') : undefined }}>
              {news ? t('BREAKING · {headline} · EXPECT VOLATILITY ·', { headline: t(news.headline) }) : t('No headlines. Markets are trading on the cycle.')}
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {COIN_IDS.map((c) => (
          <PixelButton key={c} size="sm" variant={coin === c ? 'primary' : 'secondary'} onClick={() => setCoin(c)} silent aria-label={`$${c}`} data-testid={`coin-tab-${c}`}>
            <span className="flex items-center gap-1">
              <SpriteImg src={sprites.coinIcon(c)} width={14} height={14} alt="" />${c}
              {s.minedCoin === c && <span className="text-[9px] text-lime" title={t('Currently mined')}>⛏</span>}
            </span>
          </PixelButton>
        ))}
        <div className="ml-auto text-right leading-none">
          <div className="font-pixel text-[12px] text-glow" style={{ color: info.color }}>
            {formatPrice(m.price)}
          </div>
          <div className="text-[16px]" style={{ color: change >= 0 ? '#a3e635' : '#f43f5e' }}>
            {change >= 0 ? '▲' : '▼'} {t('{pct}% (6 min)', { pct: Math.abs(change * 100).toFixed(2) })}
          </div>
        </div>
      </div>

      <CryptoCanvasChart coin={coin} height={190} />
      <p className="text-[16px] leading-tight text-dim">
        <span style={{ color: info.color }}>{t(info.name)}</span> — {t(info.blurb)}
      </p>

      <div className="grid grid-cols-2 gap-2 bg-panel-2 p-2 text-[17px] leading-tight">
        <div>
          <div className="font-silk text-[9px] text-dim">{t('HOLDINGS')}</div>
          <div style={{ color: info.color }}>
            {formatNumber(holding)} ${coin}
          </div>
          <div className="text-dim">≈ {formatCash(value)}</div>
        </div>
        <div>
          <div className="font-silk text-[9px] text-dim">{t('SELL PRICE (net)')}</div>
          <div>{formatPrice(unit)}</div>
          <div className="text-dim">{t('fee {pct}%', { pct: (MARKET.fee * 100).toFixed(1) })}{mods.sellBonus > 0 ? ` · ${t('+{pct}% insider', { pct: (mods.sellBonus * 100).toFixed(0) })}` : ''}</div>
        </div>
        {coin === 'MEME' && (
          <div className="col-span-2">
            <span className="text-dim">{t('Unrealized P&L:')} </span>
            <span style={{ color: pnl >= 0 ? '#a3e635' : '#f43f5e' }}>{pnl >= 0 ? '+' : ''}{formatCash(pnl)}</span>
          </div>
        )}
        {(coin === 'BYT' || coin === 'NOVA') && (
          <div className="col-span-2 text-dim" data-testid="alt-cost-basis">
            {t('Cost basis: {cost} (mined coins cost nothing, so selling them is pure profit).', { cost: formatCash(costBasis) })}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <span className="w-12 font-silk text-[10px] text-dim">{t('SELL')}</span>
        {[0.25, 0.5, 1].map((p) => (
          <PixelButton key={p} size="xs" variant="danger" disabled={holding <= 0} onClick={() => sellCoin(coin, holding * p)}>
            {p * 100}%
          </PixelButton>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="w-12 font-silk text-[10px] text-dim">{t('BUY')}</span>
        {[0.1, 0.25, 0.5].map((p) => (
          <PixelButton key={p} size="xs" variant="success" disabled={cash < 1} onClick={() => buyCoin(coin, cash * p)}>
            {t('{pct}% cash', { pct: p * 100 })}
          </PixelButton>
        ))}
        <input className="retro-input w-24" type="number" min={0} value={buyAmount} onChange={(e) => setBuyAmount(e.target.value)} aria-label={t('Buy amount in cash')} />
        <PixelButton size="xs" variant="success" disabled={!(Number(buyAmount) > 0) || Number(buyAmount) > cash} onClick={() => buyCoin(coin, Number(buyAmount))}>
          {t('Buy $')}
        </PixelButton>
      </div>

      {s.vip.autoSellPeaks && (
        <label className="flex items-center gap-2 bg-[#422006] px-2 py-1 text-[17px] text-gold">
          <input type="checkbox" checked={s.vip.autoSellEnabled} onChange={(e) => setAutoSellEnabled(e.target.checked)} />
          <TrendingUp size={14} /> {t('VIP Peak Auto-Seller: dump all $CC above {x}x', { x: MARKET.vipPeakThreshold })}
        </label>
      )}

      {/* Take-profit / stop-loss orders */}
      <div className="border-t-2 border-[#1b1838] pt-2" data-testid="orders">
        <div className="mb-2 flex items-center gap-2">
          <Crosshair size={14} className="text-lime" />
          <span className="font-pixel text-[9px] text-lime">{t('ORDERS')}</span>
          <span className="text-[15px] text-dim">{s.orders.length}/{ORDERS.max}</span>
        </div>
        {!s.orderDesk ? (
          <p className="text-[16px] leading-tight text-dim">
            {t('Take-profit and stop-loss orders sell for you at a price, once, even while you are away.')}{' '}
            <button type="button" className="text-neon underline" onClick={() => setSideTab('lab')}>{t('Research the Order Desk in the Lab.')}</button>
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1 text-[16px]">
              <select className="retro-input" value={orderKind} onChange={(e) => { const k = e.target.value as OrderKind; setOrderKind(k); setOrderMul(k === 'tp' ? 1.2 : 0.85); }} aria-label={t('Order type')} data-testid="order-kind">
                <option value="tp">{t('Take-profit')}</option>
                <option value="sl">{t('Stop-loss')}</option>
              </select>
              <span className="text-dim">${coin} {orderKind === 'tp' ? '≥' : '≤'}</span>
              <NumberField className="w-16" step={0.05} min={0.05} max={20} value={orderMul} onCommit={setOrderMul} aria-label={t('Trigger as a multiple of the current price')} />
              <span className="text-dim">x = {formatPrice(m.price * orderMul)}</span>
              <NumberField className="w-14" min={ORDERS.minPct} max={ORDERS.maxPct} value={orderPct} onCommit={setOrderPct} aria-label={t('Amount percent')} />
              <span className="text-dim">%</span>
              <PixelButton size="xs" variant="success" disabled={s.orders.length >= ORDERS.max} onClick={() => addOrder(coin, orderKind, m.price * orderMul, orderPct)} data-testid="order-add">
                {t('Place order')}
              </PixelButton>
            </div>
            <div className="mt-1 flex flex-col gap-1">
              {s.orders.map((o) => (
                <div key={o.id} className="flex items-center gap-2 bg-panel-2 px-1.5 py-1 text-[16px]" data-testid="order-row">
                  <span className="font-pixel text-[8px]" style={{ color: o.kind === 'tp' ? '#a3e635' : '#f43f5e' }}>{o.kind === 'tp' ? t('TAKE-PROFIT') : t('STOP-LOSS')}</span>
                  <span>
                    {t('sell {pct}% ${coin} at {op} {price}', { pct: o.amountPct, coin: o.coin, op: o.kind === 'tp' ? '≥' : '≤', price: formatPrice(o.price) })}
                  </span>
                  <span className="text-dim">({t('now {price}', { price: formatPrice(s.market[o.coin].price) })})</span>
                  <button type="button" onClick={() => removeOrder(o.id)} className="ml-auto text-dim hover:text-hot" aria-label={t('Cancel order')}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="border-t-2 border-[#1b1838] pt-2">
        <div className="mb-2 flex items-center gap-2">
          <Bot size={14} className="text-neon" />
          <span className="font-pixel text-[9px] text-neon">{t('TRADING BOTS')}</span>
          <span className="text-[15px] text-dim">
            {s.bots.length}/{MARKET.maxBots}
          </span>
          <PixelButton size="xs" variant="primary" className="ml-auto" icon={<Plus size={10} />} disabled={s.bots.length >= MARKET.maxBots || level < BOT_UNLOCK_LEVEL} onClick={addBot}>
            {level < BOT_UNLOCK_LEVEL ? t('LV {n}', { n: BOT_UNLOCK_LEVEL }) : t('New bot')}
          </PixelButton>
        </div>
        {s.bots.length === 0 && <p className="text-[16px] text-dim">{t("Bots execute rules every tick, even while you're offline. Example: sell 100% $CC when price ≥ 1.15x base.")}</p>}
        <div className="flex flex-col gap-2">
          {s.bots.map((b) => (
            <BotRow key={b.id} bot={b} onChange={(patch) => updateBot(b.id, patch)} onRemove={() => removeBot(b.id)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function BotRow({ bot, onChange, onRemove }: { bot: TradingBot; onChange: (p: Partial<TradingBot>) => void; onRemove: () => void }) {
  const t = useT();
  return (
    <div className={cn('flex flex-wrap items-center gap-1 bg-panel-2 p-1.5 text-[16px]', !bot.enabled && 'opacity-60')}>
      <button type="button" onClick={() => onChange({ enabled: !bot.enabled })} className={bot.enabled ? 'text-lime' : 'text-dim'} aria-label={t('Toggle bot')}>
        <Power size={14} />
      </button>
      <span className="text-dim">{t('IF')}</span>
      <select className="retro-input" value={bot.coin} onChange={(e) => onChange({ coin: e.target.value as CoinId })}>
        {COIN_IDS.map((c) => (
          <option key={c} value={c}>${c}</option>
        ))}
      </select>
      <select className="retro-input" value={bot.trigger} onChange={(e) => onChange({ trigger: e.target.value as TradingBot['trigger'] })}>
        <option value="above">≥</option>
        <option value="below">≤</option>
      </select>
      <NumberField className="w-16" step={0.05} min={0.1} max={10} value={bot.threshold} onCommit={(threshold) => onChange({ threshold })} aria-label={t('Threshold multiple')} />
      <span className="text-dim">{t('x THEN')}</span>
      <select className="retro-input" value={bot.side} onChange={(e) => onChange({ side: e.target.value as TradingBot['side'] })}>
        <option value="sell">{t('SELL')}</option>
        <option value="buy">{t('BUY')}</option>
      </select>
      <NumberField className="w-14" min={1} max={100} value={bot.amountPct} onCommit={(amountPct) => onChange({ amountPct })} aria-label={t('Amount percent')} />
      <span className="text-dim">{t('% · cd')}</span>
      <NumberField className="w-14" min={5} max={600} value={bot.cooldownSec} onCommit={(cooldownSec) => onChange({ cooldownSec })} aria-label={t('Cooldown seconds')} />
      <span className="text-dim">s</span>
      <button type="button" onClick={onRemove} className="ml-auto text-dim hover:text-hot" aria-label={t('Delete bot')}>
        <Trash2 size={14} />
      </button>
    </div>
  );
}
