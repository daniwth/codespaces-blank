import confetti from 'canvas-confetti';
import { Award, Coins, Crown, LineChart, Network, Server, Settings, ShoppingCart } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useSfxBridge } from '../hooks/useAudioFx';
import { useGameLoop, type LoopMode } from '../hooks/useGameLoop';
import type { SideTab } from '../store/storeTypes';
import { useGameShallow, useGameStore } from '../store/useGameStore';
import { fxBus } from '../utils/eventBus';
import { BiosOverclockModal } from './game/BiosOverclockModal';
import { EventLog } from './game/EventLog';
import { OfflineModal } from './game/OfflineModal';
import { RackDetailModal } from './game/RackDetailModal';
import { WorldCanvas } from './game/WorldCanvas';
import { MarketTerminal } from './market/MarketTerminal';
import { AchievementsPanel } from './panels/AchievementsPanel';
import { InventoryPanel } from './panels/InventoryPanel';
import { PoolsPanel } from './panels/PoolsPanel';
import { SettingsPanel } from './panels/SettingsPanel';
import { VipPanel } from './panels/VipPanel';
import { HalvingTalentTree } from './prestige/HalvingTalentTree';
import { HardwareShop } from './shop/HardwareShop';
import { LotteryToast } from './ui/LotteryToast';
import { RetroHUD } from './ui/RetroHUD';

const TABS: { id: SideTab; label: string; icon: ReactNode; color: string }[] = [
  { id: 'shop', label: 'Shop', icon: <ShoppingCart size={14} />, color: '#facc15' },
  { id: 'rigs', label: 'Rigs', icon: <Server size={14} />, color: '#22d3ee' },
  { id: 'market', label: 'Market', icon: <LineChart size={14} />, color: '#4ade80' },
  { id: 'pools', label: 'Pools', icon: <Network size={14} />, color: '#a3e635' },
  { id: 'halving', label: 'Halving', icon: <Coins size={14} />, color: '#fbbf24' },
  { id: 'vip', label: 'VIP', icon: <Crown size={14} />, color: '#e879f9' },
  { id: 'trophies', label: 'Trophies', icon: <Award size={14} />, color: '#facc15' },
  { id: 'system', label: 'System', icon: <Settings size={14} />, color: '#a5b4fc' },
];

export function App() {
  const [loopMode, setLoopMode] = useState<LoopMode | null>(null);
  useGameLoop(setLoopMode);
  useSfxBridge();
  const ui = useGameShallow((s) => ({ sideTab: s.sideTab, selectedRack: s.selectedRack, biosGpu: s.biosGpu }));
  const setSideTab = useGameStore((s) => s.setSideTab);

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

  const tab = TABS.find((t) => t.id === ui.sideTab) ?? TABS[0];

  return (
    <div className="flex min-h-full flex-col">
      <RetroHUD />
      <main className="grid flex-1 grid-cols-1 gap-3 p-2 sm:p-3 xl:grid-cols-[minmax(0,1fr)_460px]">
        <div className="flex min-w-0 flex-col gap-3">
          <WorldCanvas />
          <EventLog />
        </div>
        <aside className="pixel-box flex min-h-[520px] min-w-0 flex-col xl:max-h-[calc(100vh-150px)]">
          <nav className="flex flex-wrap gap-0.5 border-b-2 border-[#1b1838] p-1.5" aria-label="Panels">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSideTab(t.id)}
                className="flex items-center gap-1 px-2 py-1.5 font-pixel text-[8px] uppercase transition-colors"
                style={
                  ui.sideTab === t.id
                    ? { color: '#07060f', background: t.color, boxShadow: `0 0 10px ${t.color}66` }
                    : { color: t.color, background: '#141128' }
                }
              >
                {t.icon}
                <span className="hidden sm:inline">{t.label}</span>
              </button>
            ))}
          </nav>
          <div className="flex items-center gap-2 px-3 pt-2 font-pixel text-[10px]" style={{ color: tab.color }}>
            {tab.icon} {tab.label.toUpperCase()}
          </div>
          <div className="retro-scroll min-h-0 flex-1 overflow-y-auto p-3">
            {ui.sideTab === 'shop' && <HardwareShop />}
            {ui.sideTab === 'rigs' && <InventoryPanel />}
            {ui.sideTab === 'market' && <MarketTerminal />}
            {ui.sideTab === 'pools' && <PoolsPanel />}
            {ui.sideTab === 'halving' && <HalvingTalentTree />}
            {ui.sideTab === 'vip' && <VipPanel />}
            {ui.sideTab === 'trophies' && <AchievementsPanel />}
            {ui.sideTab === 'system' && <SettingsPanel loopMode={loopMode} />}
          </div>
        </aside>
      </main>

      {ui.selectedRack && <RackDetailModal rackUid={ui.selectedRack} />}
      {ui.biosGpu && <BiosOverclockModal gpuUid={ui.biosGpu} />}
      <OfflineModal />
      <LotteryToast />
    </div>
  );
}
