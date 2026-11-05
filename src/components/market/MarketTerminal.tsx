import { Bot, Plus, Power, Trash2, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { BOT_UNLOCK_LEVEL, MARKET, levelFromEarnings } from '../../config/gameBalance';
import { talentModifiers } from '../../config/prestigeTree';
import { sellPrice } from '../../store/gamePhysics';
import { useGameShallow, useGameStore } from '../../store/useGameStore';
import type { CoinId, TradingBot } from '../../types/economy';
import { bnToNumber } from '../../utils/bignum';
import { cn } from '../../utils/cn';
import { formatCash, formatNumber, formatPrice } from '../../utils/formatters';
import { NumberField } from '../ui/NumberField';
import { PixelButton } from '../ui/PixelButton';
import { CryptoCanvasChart } from './CryptoCanvasChart';

const COIN_INFO: Record<CoinId, { name: string; color: string; blurb: string }> = {
  CC: { name: 'CryptoCoin', color: '#22d3ee', blurb: 'Settlement coin your rigs mine. Mean-reverting around $1.' },
  MEME: { name: 'Shitcoin', color: '#e879f9', blurb: 'Pure degen fuel: swings from 0.1x to 10x. Pumps & dumps.' },
};

export function MarketTerminal() {
  const [coin, setCoin] = useState<CoinId>('CC');
  const [buyAmount, setBuyAmount] = useState('100');
  const s = useGameShallow((st) => ({
    market: st.market,
    cc: st.cc,
    meme: st.meme,
    memeCost: st.memeCostBasis,
    cash: st.cash,
    talents: st.talents,
    bots: st.bots,
    lifetime: st.lifetimeEarnings,
    vip: st.vip,
  }));
  const { sellCoin, buyCoin, addBot, updateBot, removeBot, setAutoSellEnabled } = useGameStore.getState();
  const holding = coin === 'CC' ? bnToNumber(s.cc) : s.meme;
  const mods = talentModifiers(s.talents);
  const unit = sellPrice(s.market, coin, mods);
  const value = holding * unit;
  const cash = bnToNumber(s.cash);
  const m = s.market[coin];
  const first = m.candles[0]?.o ?? m.price;
  const change = m.price / first - 1;
  const pnl = coin === 'MEME' ? value - s.memeCost : 0;
  const level = levelFromEarnings(bnToNumber(s.lifetime));
  const info = COIN_INFO[coin];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1">
        {(['CC', 'MEME'] as const).map((c) => (
          <PixelButton key={c} size="sm" variant={coin === c ? 'primary' : 'secondary'} onClick={() => setCoin(c)} silent>
            ${c}
          </PixelButton>
        ))}
        <div className="ml-auto text-right leading-none">
          <div className="font-pixel text-[12px] text-glow" style={{ color: info.color }}>
            {formatPrice(m.price)}
          </div>
          <div className="text-[16px]" style={{ color: change >= 0 ? '#a3e635' : '#f43f5e' }}>
            {change >= 0 ? '▲' : '▼'} {Math.abs(change * 100).toFixed(2)}% (6 min)
          </div>
        </div>
      </div>

      <CryptoCanvasChart coin={coin} height={190} />
      <p className="text-[16px] leading-tight text-dim">
        <span style={{ color: info.color }}>{info.name}</span> — {info.blurb}
      </p>

      <div className="grid grid-cols-2 gap-2 bg-panel-2 p-2 text-[17px] leading-tight">
        <div>
          <div className="font-silk text-[9px] text-dim">HOLDINGS</div>
          <div style={{ color: info.color }}>
            {formatNumber(holding)} ${coin}
          </div>
          <div className="text-dim">≈ {formatCash(value)}</div>
        </div>
        <div>
          <div className="font-silk text-[9px] text-dim">SELL PRICE (net)</div>
          <div>{formatPrice(unit)}</div>
          <div className="text-dim">fee {(MARKET.fee * 100).toFixed(1)}%{mods.sellBonus > 0 ? ` · +${(mods.sellBonus * 100).toFixed(0)}% insider` : ''}</div>
        </div>
        {coin === 'MEME' && (
          <div className="col-span-2">
            <span className="text-dim">Unrealized P&L: </span>
            <span style={{ color: pnl >= 0 ? '#a3e635' : '#f43f5e' }}>{pnl >= 0 ? '+' : ''}{formatCash(pnl)}</span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <span className="w-12 font-silk text-[10px] text-dim">SELL</span>
        {[0.25, 0.5, 1].map((p) => (
          <PixelButton key={p} size="xs" variant="danger" disabled={holding <= 0} onClick={() => sellCoin(coin, holding * p)}>
            {p * 100}%
          </PixelButton>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="w-12 font-silk text-[10px] text-dim">BUY</span>
        {[0.1, 0.25, 0.5].map((p) => (
          <PixelButton key={p} size="xs" variant="success" disabled={cash < 1} onClick={() => buyCoin(coin, cash * p)}>
            {p * 100}% cash
          </PixelButton>
        ))}
        <input className="retro-input w-24" type="number" min={0} value={buyAmount} onChange={(e) => setBuyAmount(e.target.value)} aria-label="Buy amount in cash" />
        <PixelButton size="xs" variant="success" disabled={!(Number(buyAmount) > 0) || Number(buyAmount) > cash} onClick={() => buyCoin(coin, Number(buyAmount))}>
          Buy $
        </PixelButton>
      </div>

      {s.vip.autoSellPeaks && (
        <label className="flex items-center gap-2 bg-[#422006] px-2 py-1 text-[17px] text-gold">
          <input type="checkbox" checked={s.vip.autoSellEnabled} onChange={(e) => setAutoSellEnabled(e.target.checked)} />
          <TrendingUp size={14} /> VIP Peak Auto-Seller: dump all $CC above {MARKET.vipPeakThreshold}x
        </label>
      )}

      <div className="border-t-2 border-[#1b1838] pt-2">
        <div className="mb-2 flex items-center gap-2">
          <Bot size={14} className="text-neon" />
          <span className="font-pixel text-[9px] text-neon">TRADING BOTS</span>
          <span className="text-[15px] text-dim">
            {s.bots.length}/{MARKET.maxBots}
          </span>
          <PixelButton size="xs" variant="primary" className="ml-auto" icon={<Plus size={10} />} disabled={s.bots.length >= MARKET.maxBots || level < BOT_UNLOCK_LEVEL} onClick={addBot}>
            {level < BOT_UNLOCK_LEVEL ? `LV ${BOT_UNLOCK_LEVEL}` : 'New bot'}
          </PixelButton>
        </div>
        {s.bots.length === 0 && <p className="text-[16px] text-dim">Bots execute rules every tick, even while you're offline. Example: sell 100% $CC when price ≥ 1.15x base.</p>}
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
  return (
    <div className={cn('flex flex-wrap items-center gap-1 bg-panel-2 p-1.5 text-[16px]', !bot.enabled && 'opacity-60')}>
      <button type="button" onClick={() => onChange({ enabled: !bot.enabled })} className={bot.enabled ? 'text-lime' : 'text-dim'} aria-label="Toggle bot">
        <Power size={14} />
      </button>
      <span className="text-dim">IF</span>
      <select className="retro-input" value={bot.coin} onChange={(e) => onChange({ coin: e.target.value as CoinId })}>
        <option value="CC">$CC</option>
        <option value="MEME">$MEME</option>
      </select>
      <select className="retro-input" value={bot.trigger} onChange={(e) => onChange({ trigger: e.target.value as TradingBot['trigger'] })}>
        <option value="above">≥</option>
        <option value="below">≤</option>
      </select>
      <NumberField className="w-16" step={0.05} min={0.1} max={10} value={bot.threshold} onCommit={(threshold) => onChange({ threshold })} aria-label="Threshold multiple" />
      <span className="text-dim">x THEN</span>
      <select className="retro-input" value={bot.side} onChange={(e) => onChange({ side: e.target.value as TradingBot['side'] })}>
        <option value="sell">SELL</option>
        <option value="buy">BUY</option>
      </select>
      <NumberField className="w-14" min={1} max={100} value={bot.amountPct} onCommit={(amountPct) => onChange({ amountPct })} aria-label="Amount percent" />
      <span className="text-dim">% · cd</span>
      <NumberField className="w-14" min={5} max={600} value={bot.cooldownSec} onCommit={(cooldownSec) => onChange({ cooldownSec })} aria-label="Cooldown seconds" />
      <span className="text-dim">s</span>
      <button type="button" onClick={onRemove} className="ml-auto text-dim hover:text-hot" aria-label="Delete bot">
        <Trash2 size={14} />
      </button>
    </div>
  );
}
