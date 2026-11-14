import type { CoinId, MarketCycle, MarketPhaseId, NewsId } from '../types/economy';

/**
 * The market breathes in four recognisable phases that follow each other in a loop. Each one pulls the
 * mean of every coin's price walk (see `stepMarket`) and scales its volatility, so the terminal has a
 * "when" as well as a "what": accumulate in the quiet, sell into the Bull Run, ride the alts in Altseason
 * and sit out (or buy) the Bear.
 */
export interface MarketPhaseDef {
  id: MarketPhaseId;
  name: string;
  description: string;
  color: string;
  /** Seconds the phase lasts (uniform). */
  duration: [number, number];
  /** Multiplier on each coin's mean price while the phase lasts. */
  meanMul: Record<CoinId, number>;
  /** Multiplier on every coin's volatility. */
  sigmaMul: number;
  next: MarketPhaseId;
}

export const MARKET_PHASES: Record<MarketPhaseId, MarketPhaseDef> = {
  accumulation: {
    id: 'accumulation', name: 'Accumulation', color: '#94a3b8', duration: [200, 320], sigmaMul: 0.7, next: 'bull',
    description: 'Quiet, sideways prices. Smart money is buying.',
    meanMul: { CC: 1, MEME: 1, BYT: 1, NOVA: 1 },
  },
  bull: {
    id: 'bull', name: 'Bull Run', color: '#22c55e', duration: [160, 260], sigmaMul: 1.1, next: 'altseason',
    description: '$CC leads the market up. A good time to sell what you mined.',
    meanMul: { CC: 1.35, MEME: 1.2, BYT: 1.08, NOVA: 1.3 },
  },
  altseason: {
    id: 'altseason', name: 'Altseason', color: '#e879f9', duration: [100, 180], sigmaMul: 1.3, next: 'bear',
    description: 'Money rotates into $NOVA, $BYT and $MEME while $CC cools off.',
    meanMul: { CC: 1.05, MEME: 2, BYT: 1.2, NOVA: 1.7 },
  },
  bear: {
    id: 'bear', name: 'Bear Market', color: '#f43f5e', duration: [160, 260], sigmaMul: 1, next: 'accumulation',
    description: 'Everything bleeds. Hold, or buy what others are dumping.',
    meanMul: { CC: 0.72, MEME: 0.6, BYT: 0.92, NOVA: 0.6 },
  },
};

export const MARKET_PHASE_IDS: MarketPhaseId[] = ['accumulation', 'bull', 'altseason', 'bear'];
export const isMarketPhase = (v: unknown): v is MarketPhaseId => typeof v === 'string' && v in MARKET_PHASES;

/** A headline on the terminal's ticker: a short burst of volatility (and a pull) on $CC and/or $MEME. */
export interface NewsDef {
  id: NewsId;
  headline: string;
  positive: boolean;
  /** Seconds the story moves the market. */
  duration: [number, number];
  /** Pull on the mean and volatility multiplier of the coins it touches. */
  effects: Partial<Record<'CC' | 'MEME', { meanMul: number; sigmaMul: number }>>;
}

export const NEWS: Record<NewsId, NewsDef> = {
  etf_rumor: { id: 'etf_rumor', positive: true, duration: [25, 45], headline: 'ETF rumor: funds are said to be filing for a spot $CC product', effects: { CC: { meanMul: 1.25, sigmaMul: 2 } } },
  exchange_hack: { id: 'exchange_hack', positive: false, duration: [25, 45], headline: 'Exchange hacked: withdrawals frozen, $CC sold in a panic', effects: { CC: { meanMul: 0.8, sigmaMul: 2.5 } } },
  influencer_shill: { id: 'influencer_shill', positive: true, duration: [20, 35], headline: 'A celebrity posts a rocket next to $MEME', effects: { MEME: { meanMul: 2.5, sigmaMul: 2 } } },
  rug_pull: { id: 'rug_pull', positive: false, duration: [20, 35], headline: 'Rug pull fears: $MEME developers move their wallets', effects: { MEME: { meanMul: 0.45, sigmaMul: 2.5 } } },
  regulation: { id: 'regulation', positive: false, duration: [30, 50], headline: 'Regulators announce a crypto crackdown', effects: { CC: { meanMul: 0.88, sigmaMul: 1.8 }, MEME: { meanMul: 0.7, sigmaMul: 1.8 } } },
  whale_wallet: { id: 'whale_wallet', positive: true, duration: [20, 40], headline: 'A dormant whale wallet wakes up: nobody knows which way it trades', effects: { CC: { meanMul: 1, sigmaMul: 3 } } },
};

export const NEWS_IDS: NewsId[] = ['etf_rumor', 'exchange_hack', 'influencer_shill', 'rug_pull', 'regulation', 'whale_wallet'];
export const isNewsId = (v: unknown): v is NewsId => typeof v === 'string' && v in NEWS;

/** Seconds between two headlines (uniform), counted from the end of the previous one. */
export const NEWS_INTERVAL: [number, number] = [70, 150];

/** Longest a phase or a story can still have to run (sanitizing bound). */
export const MAX_PHASE_SEC = Math.max(...MARKET_PHASE_IDS.map((id) => MARKET_PHASES[id].duration[1]));
export const MAX_NEWS_SEC = Math.max(...NEWS_IDS.map((id) => NEWS[id].duration[1]));

export const newCycle = (now: number, rng: () => number = Math.random): MarketCycle => {
  const def = MARKET_PHASES.accumulation;
  return {
    phase: 'accumulation',
    startedAt: now,
    endsAt: now + (def.duration[0] + rng() * (def.duration[1] - def.duration[0])) * 1000,
    news: null,
    nextNewsAt: now + (NEWS_INTERVAL[0] + rng() * (NEWS_INTERVAL[1] - NEWS_INTERVAL[0])) * 1000,
  };
};

/** Mean and volatility multipliers of one coin under the cycle's phase and current headline. */
export function cycleEffect(cycle: Pick<MarketCycle, 'phase' | 'news'>, coin: CoinId, now: number): { meanMul: number; sigmaMul: number } {
  const phase = MARKET_PHASES[cycle.phase];
  let meanMul = phase.meanMul[coin];
  let sigmaMul = phase.sigmaMul;
  const news = cycle.news && now < cycle.news.endsAt ? NEWS[cycle.news.id].effects : undefined;
  const hit = news && (coin === 'CC' || coin === 'MEME') ? news[coin] : undefined;
  if (hit) {
    meanMul *= hit.meanMul;
    sigmaMul *= hit.sigmaMul;
  }
  return { meanMul, sigmaMul };
}

/** Take-profit / stop-loss orders (Order Desk research). */
export const ORDERS = { max: 6, minPct: 1, maxPct: 100 } as const;
