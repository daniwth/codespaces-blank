import { Handshake, Rocket } from 'lucide-react';
import { POOLS, levelFromEarnings } from '../../config/gameBalance';
import { ABILITIES, RANKS, abilityUnlocked, type AbilityId } from '../../config/ranks';
import { useT } from '../../i18n';
import { flashQuote } from '../../store/gamePhysics';
import { useGameShallow, useGameStore } from '../../store/useGameStore';
import { bnGte, bnToNumber } from '../../utils/bignum';
import { formatCash, formatDuration, formatHashrate, formatNumber } from '../../utils/formatters';
import { PixelButton } from '../ui/PixelButton';

const rankFor = (id: AbilityId): string => RANKS.find((r) => r.unlock === id)?.name ?? '';
const left = (until: number, now: number): number => Math.max(0, Math.ceil((until - now) / 1000));

/** Rank abilities that act on the pool: Flash Mining (rented hashrate) and Pool Partner (exclusivity). */
export function RankAbilities({ now }: { now: number }) {
  const t = useT();
  const s = useGameShallow((st) => ({
    lifetime: st.lifetimeEarnings, cash: st.cash, live: st.live, pool: st.pool, coin: st.minedCoin,
    price: st.market[st.minedCoin].price, buffs: st.buffs, partner: st.partner,
  }));
  const { rentHashrate, signPartner } = useGameStore.getState();
  const level = levelFromEarnings(bnToNumber(s.lifetime));
  const flashOn = abilityUnlocked('flash', level);
  const partnerOn = abilityUnlocked('partner', level);
  const quote = flashQuote(s.live, s.pool, s.coin, s.price);
  const renting = now < s.buffs.rentUntil;
  const rentWait = left(s.buffs.rentCooldownUntil, now);
  const partnered = s.partner !== null && now < s.partner.until;
  const partnerWait = left(s.buffs.partnerCooldownUntil, now);
  const locked = (id: AbilityId) => <span className="block text-dim">{t('Unlocks at the rank {rank}.', { rank: t(rankFor(id)) })}</span>;

  return (
    <>
      <h3 className="mt-1 font-pixel text-[9px] text-neon">{t('RANK ABILITIES')}</h3>
      <div className={`flex items-center gap-3 bg-panel-2 p-2 text-[16px] leading-tight ${flashOn ? '' : 'opacity-60'}`} data-testid="ability-flash">
        <Rocket size={18} className="shrink-0 text-[#38bdf8]" />
        <span className="min-w-0 flex-1">
          <span className="font-pixel text-[9px] text-[#38bdf8]">{t('Flash Mining')}</span>
          <span className="block text-ink/90">{t('Rent remote hashrate equal to your own for {time}. You pay most of its expected yield up front: it wins when the price climbs or the pool gets lucky.', { time: formatDuration(ABILITIES.flash.durationSec) })}</span>
          {!flashOn ? locked('flash') : renting ? (
            <span className="block text-lime" data-testid="flash-active">{t('Renting {hash}: {time} left', { hash: formatHashrate(s.buffs.rentHash), time: formatDuration(left(s.buffs.rentUntil, now)) })}</span>
          ) : (
            <span className="block text-dim">
              {t('+{hash} · about {coins} ${coin} · you pay {pct}% of its expected value', { hash: formatHashrate(quote.hash), coins: formatNumber(quote.coins, 2), coin: s.coin, pct: Math.round(ABILITIES.flash.feeShare * 100) })}
            </span>
          )}
        </span>
        <PixelButton size="xs" variant="success" disabled={!flashOn || renting || rentWait > 0 || !(quote.hash > 0) || !bnGte(s.cash, quote.fee)} onClick={() => rentHashrate()} data-testid="flash-rent">
          {renting ? t('ACTIVE') : rentWait > 0 ? formatDuration(rentWait) : t('Rent ({fee})', { fee: formatCash(quote.fee) })}
        </PixelButton>
      </div>
      <div className={`flex items-center gap-3 bg-panel-2 p-2 text-[16px] leading-tight ${partnerOn ? '' : 'opacity-60'}`} data-testid="ability-partner">
        <Handshake size={18} className="shrink-0 text-[#c084fc]" />
        <span className="min-w-0 flex-1">
          <span className="font-pixel text-[9px] text-[#c084fc]">{t('Pool Partner')}</span>
          <span className="block text-ink/90">{t('Exclusivity deal with your current pool: +{pct}% payout for {time}. Switching pool early costs {points} reputation.', { pct: Math.round((ABILITIES.partner.payoutMul - 1) * 100), time: formatDuration(ABILITIES.partner.durationSec), points: ABILITIES.partner.breakPoints })}</span>
          {!partnerOn ? locked('partner') : partnered && s.partner ? (
            <span className="block text-lime" data-testid="partner-active">
              {t('Partner of {pool}: {time} left', { pool: t(POOLS[s.partner.pool].name), time: formatDuration(left(s.partner.until, now)) })}
              {s.partner.pool !== s.pool && <span className="text-hot"> · {t('no bonus outside the partner pool')}</span>}
            </span>
          ) : null}
        </span>
        <PixelButton size="xs" variant="success" disabled={!partnerOn || partnered || partnerWait > 0} onClick={() => signPartner()} data-testid="partner-sign">
          {partnered ? t('ACTIVE') : partnerWait > 0 ? formatDuration(partnerWait) : t('Sign')}
        </PixelButton>
      </div>
    </>
  );
}
