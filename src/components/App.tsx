import confetti from 'canvas-confetti';
import { Award, ClipboardList, Cloud, Coins, Crown, FlaskConical, LineChart, Network, Server, Settings, ShoppingCart } from 'lucide-react';
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { useT } from '../i18n';
import { useSfxBridge } from '../hooks/useAudioFx';
import { useCloudSync } from '../hooks/useCloudSync';
import { AccountPanel } from './account/AccountPanel';
import { useGameLoop, type LoopMode } from '../hooks/useGameLoop';
import { useHotkeys } from '../hooks/useHotkeys';
import type { SideTab } from '../store/storeTypes';
import { useGameShallow, useGameStore } from '../store/useGameStore';
import { fxBus } from '../utils/eventBus';
import { BiosOverclockModal } from './game/BiosOverclockModal';
import { EventLog } from './game/EventLog';
import { DailyModal } from './game/DailyModal';
import { OfflineModal } from './game/OfflineModal';
import { RackDetailModal } from './game/RackDetailModal';
import { WorldCanvas } from './game/WorldCanvas';
import { MarketTerminal } from './market/MarketTerminal';
import { AchievementsPanel } from './panels/AchievementsPanel';
import { ContractsPanel } from './panels/ContractsPanel';
import { InventoryPanel } from './panels/InventoryPanel';
import { LabPanel } from './panels/LabPanel';
import { PoolsPanel } from './panels/PoolsPanel';
import { SettingsPanel } from './panels/SettingsPanel';
import { VipPanel } from './panels/VipPanel';
import { HalvingTalentTree } from './prestige/HalvingTalentTree';
import { HardwareShop } from './shop/HardwareShop';
import { ContractToast } from './ui/ContractToast';
import { TitleScreen } from './menu/TitleScreen';
import { LotteryToast } from './ui/LotteryToast';
import { RetroHUD } from './ui/RetroHUD';

const Wiki = lazy(() => import('./wiki/Wiki'));

const TABS: { id: SideTab; label: string; icon: ReactNode; color: string }[] = [
  { id: 'shop', label: 'Shop', icon: <ShoppingCart size={14} />, color: '#facc15' },
  { id: 'rigs', label: 'Rigs', icon: <Server size={14} />, color: '#22d3ee' },
  { id: 'lab', label: 'Lab', icon: <FlaskConical size={14} />, color: '#c084fc' },
  { id: 'market', label: 'Market', icon: <LineChart size={14} />, color: '#4ade80' },
  { id: 'pools', label: 'Pools', icon: <Network size={14} />, color: '#a3e635' },
  { id: 'contracts', label: 'Contracts', icon: <ClipboardList size={14} />, color: '#fb923c' },
  { id: 'halving', label: 'Halving', icon: <Coins size={14} />, color: '#fbbf24' },
  { id: 'vip', label: 'VIP', icon: <Crown size={14} />, color: '#e879f9' },
  { id: 'trophies', label: 'Trophies', icon: <Award size={14} />, color: '#facc15' },
  { id: 'account', label: 'Account', icon: <Cloud size={14} />, color: '#38bdf8' },
  { id: 'system', label: 'System', icon: <Settings size={14} />, color: '#a5b4fc' },
];

export function App() {
  const [loopMode, setLoopMode] = useState<LoopMode | null>(null);
  // The loop only runs on the game screen: the title menu keeps the save frozen.
  useGameLoop(setLoopMode);
  useSfxBridge();
  useCloudSync();
  const screen = useGameStore((s) => s.screen);
  const wikiOpen = useGameStore((s) => s.wikiOpen);
  const setWikiOpen = useGameStore((s) => s.setWikiOpen);

  useEffect(
    () =>
      fxBus.on((fx) => {
        if (fx.kind !== 'confetti' || !useGameStore.getState().settings.particles) return;
        void confetti({
          particleCount: Math.round(60 + fx.intensity * 140),
          spread: 70 + fx.intensity * 50,
          startVelocity: 35 + fx.intensity * 15,
          origin: { y: 0.35 },
          shapes: ['square'],
          scalar: 1.1,
          ticks: 160,
          colors: ['#facc15', '#22d3ee', '#a3e635', '#e879f9', '#f43f5e'],
          disableForReducedMotion: true,
        });
      }),
    [],
  );

  return (
    <>
      {screen === 'menu' ? <TitleScreen /> : <GameScreen loopMode={loopMode} />}
      {wikiOpen && (
        <Suspense fallback={null}>
          <Wiki onClose={() => setWikiOpen(false)} />
        </Suspense>
      )}
    </>
  );
}

/** The running farm: HUD, world canvas, side panels and in-game modals. */
function GameScreen({ loopMode }: { loopMode: LoopMode | null }) {
  const t = useT();
  const ui = useGameShallow((s) => ({ sideTab: s.sideTab, selectedRack: s.selectedRack, biosGpu: s.biosGpu }));
  const setSideTab = useGameStore((s) => s.setSideTab);
  const contractsReady = useGameStore((s) => s.contracts.slots.filter((c) => c.completedAt !== null).length);
  const goalReady = useGameStore((s) => (s.roadmap.ready ? 1 : 0));
  /** Tabs with something waiting: a number badge, or a plain dot for "look here". */
  const badges: Partial<Record<SideTab, number>> = { contracts: contractsReady, trophies: goalReady };

  const tab = TABS.find((x) => x.id === ui.sideTab) ?? TABS[0];

  useHotkeys({
    t: () => useGameStore.getState().toggleThermalView(),
    m: () => useGameStore.getState().updateSettings({ muted: !useGameStore.getState().settings.muted }),
  });

  return (
    <div className="flex min-h-full flex-col">
      <RetroHUD />
      <main className="grid flex-1 grid-cols-1 gap-3 p-2 sm:p-3 xl:grid-cols-[minmax(0,1fr)_460px]">
        <div className="flex min-w-0 flex-col gap-3">
          <WorldCanvas />
          <EventLog />
        </div>
        <aside className="pixel-box flex min-h-[520px] min-w-0 flex-col xl:max-h-[calc(100vh-150px)]">
          <nav className="flex flex-wrap gap-0.5 border-b-2 border-[#1b1838] p-1.5" aria-label={t('Panels')}>
            {TABS.map((tb) => (
              <button
                key={tb.id}
                type="button"
                onClick={() => setSideTab(tb.id)}
                aria-label={badges[tb.id] ? t('{tab} ({n} ready to claim)', { tab: t(tb.label), n: badges[tb.id] ?? 0 }) : t(tb.label)}
                aria-current={ui.sideTab === tb.id ? 'page' : undefined}
                title={t(tb.label)}
                className="relative flex items-center gap-1 px-2 py-1.5 font-pixel text-[8px] uppercase transition-colors"
                style={
                  ui.sideTab === tb.id
                    ? { color: '#07060f', background: tb.color, boxShadow: `0 0 10px ${tb.color}66` }
                    : { color: tb.color, background: '#141128' }
                }
              >
                {tb.icon}
                <span className="hidden sm:inline">{t(tb.label)}</span>
                {(badges[tb.id] ?? 0) > 0 && (
                  <span className="blink absolute -right-1 -top-1 grid size-3.5 place-items-center bg-lime font-pixel text-[7px] text-void" aria-hidden="true">
                    {badges[tb.id]}
                  </span>
                )}
              </button>
            ))}
          </nav>
          <div className="flex items-center gap-2 px-3 pt-2 font-pixel text-[10px]" style={{ color: tab.color }}>
            {tab.icon} {t(tab.label).toUpperCase()}
          </div>
          <div className="retro-scroll min-h-0 flex-1 overflow-y-auto p-3">
            {ui.sideTab === 'shop' && <HardwareShop />}
            {ui.sideTab === 'rigs' && <InventoryPanel />}
            {ui.sideTab === 'lab' && <LabPanel />}
            {ui.sideTab === 'market' && <MarketTerminal />}
            {ui.sideTab === 'pools' && <PoolsPanel />}
            {ui.sideTab === 'contracts' && <ContractsPanel />}
            {ui.sideTab === 'halving' && <HalvingTalentTree />}
            {ui.sideTab === 'vip' && <VipPanel />}
            {ui.sideTab === 'trophies' && <AchievementsPanel />}
            {ui.sideTab === 'account' && <AccountPanel />}
            {ui.sideTab === 'system' && <SettingsPanel loopMode={loopMode} />}
          </div>
        </aside>
      </main>

      {ui.selectedRack && <RackDetailModal rackUid={ui.selectedRack} />}
      {ui.biosGpu && <BiosOverclockModal gpuUid={ui.biosGpu} />}
      <DailyModal />
      <OfflineModal />
      <LotteryToast />
      <ContractToast />
    </div>
  );
}
