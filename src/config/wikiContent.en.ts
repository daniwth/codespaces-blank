/**
 * In-game wiki, English text. Same section / entry / block structure as the
 * Spanish `sectionsEs` in `wikiContent.ts` (a unit test enforces it). Every
 * number comes from the balance config; tables come from `wikiTables.ts`.
 */
import { COIN_MARKET, MINEABLE, hashDifficulty } from './altcoins';
import { CONTRACTS, KEEP_COOL_STREAK_MIN } from './contracts';
import {
  BOT_UNLOCK_LEVEL,
  EVENT_EFFECTS,
  EVENT_INTERVAL,
  GRID,
  MARKET,
  PHYSICS,
  POOLS,
  STARTING_CASH,
  VIP_COSTS,
  earningsForLevel,
} from './gameBalance';
import { GPU_CATALOG, MAX_TECHNICIANS, OC_LIMITS, TECHNICIAN_BASE_COST, TECHNICIAN_COST_GROWTH } from './hardwareCatalog';
import { BASE_OFFLINE_HOURS, HALVING_BASE_SC, HALVING_MIN_EARNINGS, TALENT_BY_ID, earningsForSc } from './prestigeTree';
import { AIRDROP } from './airdrops';
import { AUTOPILOT, AUTOPILOT_PLANS } from './autopilot';
import { RUSH_SECONDS_PER_GEM } from './research';
import { ROADMAP } from './roadmap';
import { MAX_PADS } from './roomsCatalog';
import * as T from './wikiTables';
import {
  TECH_FULL_SPEED_GPUS, autoTuneVoltage, bedroom, bench, formula, garage, gpusPerTechPaste, info, list, maxOfflineHours, min,
  nightShift, p, pct, peak, publicFee, secondGpu, starterCcPerSec, starterFan, starterGpu, starterPsu, steel, steps, table, tip,
  warn, whisperer,
} from './wikiFacts';
import type { WikiSection } from './wikiTypes';
import { tr, type Lang } from '../i18n';
import { ocPowerMul } from '../store/gamePhysics';
import { SELL_REFUND } from '../store/slices/hardwareSlice';
import { formatCash, formatDuration, formatHashrate, formatNumber, formatPower } from '../utils/formatters';

export function sectionsEn(): WikiSection[] {
  const L: Lang = 'en';
  const n = (name: string): string => tr(name, undefined, L);
  return [
    {
      id: 'start',
      title: 'Getting started',
      icon: 'start',
      color: '#a3e635',
      summary: 'What to do, your first rig and the basic loop of a run.',
      entries: [
        {
          id: 'goal',
          title: 'The goal',
          keywords: ['meta', 'objetivo', 'goal'],
          blocks: [
            p('Hash Harvest Tycoon is a mining tycoon: you mount GPUs in racks, keep them cool and powered, and they mine **$CC** (the in-game coin). You sell the $CC for cash ($), reinvest in better hardware and bigger rooms, and the farm grows exponentially.'),
            p(`Once a run has earned ${formatCash(HALVING_MIN_EARNINGS)} you can do **The Halving**: the farm resets in exchange for **Smart Contracts ($SC)**, which buy permanent talents. Every run starts stronger and goes faster. There is no ending: the goal is an ever bigger and more efficient farm.`),
          ],
        },
        {
          id: 'starter-rig',
          title: 'Your starter rig',
          keywords: ['inicio', 'empezar', 'starter', 'start'],
          blocks: [
            p(`You start in the **${n(bedroom.name)}** with **${formatCash(STARTING_CASH)}** (plus whatever the Seed Capital talent gives) and a rig already mounted on the first pad:`),
            list(
              `**${n(bench.name)}**: ${bench.slots} GPU slots and ${bench.fanSlots} cooler slots.`,
              `One **${starterGpu.brand} ${n(starterGpu.name)}** (Bronze quality): ${formatHashrate(starterGpu.hashrate)} at ${formatPower(starterGpu.power)}.`,
              `One **${n(starterPsu.name)}** (${formatPower(starterPsu.capacity)}, ${pct(starterPsu.efficiency)} efficiency) and one **${n(starterFan.name)}**.`,
            ),
            p(`That rig mines about ${formatNumber(starterCcPerSec, 2)} $CC/s on the public pool. Click the rack in the room to see its slots, temperatures, thermal paste and power draw.`),
          ],
        },
        {
          id: 'first-buys',
          title: 'First purchases',
          keywords: ['comprar', 'tienda', 'shop', 'buy'],
          blocks: [
            steps(
              `Wait until you have about ${formatCash(starterGpu.price)} and press **Sell all CC** (top bar) to sell what you mined.`,
              `Buy another **${n(starterGpu.name)}** in **Shop → GPUs**. Every GPU comes with a random quality (silicon lottery) and goes to storage (**Rigs** tab).`,
              `Open the ${n(bedroom.name)} rack and install the GPU in the free slot: drag it, or click the GPU and then the slot. **Auto-fill** does it for you.`,
              `With the bench full, buy a **${n(steel.name)}** (${formatCash(steel.price)}), a PSU and coolers. Click an empty pad on the floor to place the rack and fill it.`,
              `Move up a tier (${n(secondGpu.name)}, ${n(GPU_CATALOG[2].name)}…) and, when the ${n(bedroom.name)} gets too small (${bedroom.pads} pads, ${formatPower(bedroom.maxPowerW)} line), buy the **${n(garage.name)}** (${formatCash(garage.price)}).`,
            ),
            tip(`A second ${n(starterGpu.name)} on the bench with the stock ${n(starterFan.name)} does not reach ${PHYSICS.throttleTemp} °C, so the first purchase is safe. The first GPU pays for itself in under two minutes.`),
          ],
        },
        {
          id: 'selling',
          title: 'Selling $CC',
          keywords: ['vender', 'sell', 'dinero', 'cash'],
          blocks: [
            p('What you mine is $CC, not cash. To buy hardware you have to sell it: with **Sell all CC** in the top bar (everything at market price) or from the **Market** tab (25%, 50% or 100%).'),
            list(
              `Every trade pays a ${pct(MARKET.fee, 1)} fee.`,
              '**Only sales count as earnings.** Earnings raise your level, unlock The Halving and count toward achievements. Hoarding $CC without selling raises nothing.',
              'The power bill is paid in cash. If you run out of cash, it is charged in $CC automatically.',
            ),
            tip('The $CC price oscillates around $1. Selling at a peak pays more: you can automate it with trading bots or the Peak Auto-Seller VIP upgrade.'),
          ],
        },
        {
          id: 'loop',
          title: 'The gameplay loop',
          keywords: ['loop', 'ciclo'],
          blocks: [
            steps(
              'Mine $CC and sell it.',
              'Buy better GPUs, PSUs with headroom and enough coolers.',
              `Watch the heat (stay below ${PHYSICS.throttleTemp} °C) and the power (PSU and room line).`,
              'Expand with racks and new rooms. Hire technicians for maintenance.',
              'Level up to unlock more profitable pools, bots and contracts.',
              `Once a run passes ${formatCash(HALVING_MIN_EARNINGS)}, do The Halving at its best moment and spend the $SC on talents.`,
            ),
          ],
        },
        {
          id: 'levels',
          title: 'Level and unlocks',
          keywords: ['nivel', 'level', 'lv', 'desbloquear', 'unlock'],
          blocks: [
            p(`Your level comes from lifetime realized earnings and is not lost to The Halving. Each level asks for about ${formatNumber(earningsForLevel(3) / earningsForLevel(2), 1)} times more earnings than the previous one.`),
            table(T.levelTable(10, L)),
          ],
        },
      ],
    },
    {
      id: 'hardware',
      title: 'Hardware',
      icon: 'hardware',
      color: '#22d3ee',
      summary: 'GPUs, silicon lottery, PSUs, coolers and racks.',
      entries: [
        {
          id: 'gpus',
          title: 'GPUs',
          keywords: ['gpu', 'asic', 'tarjeta', 'hashrate', 'tier', 'card'],
          blocks: [
            p(`There are ${GPU_CATALOG.length} device tiers, from graphics cards to ASICs and photonic chips. Each tier mines far more per watt, but costs a lot more, takes longer to pay off (×1.4–1.6 per tier) and demands better cooling, bigger PSUs and rooms with more line.`),
            table(T.gpuTable(L)),
            info('The most efficient GPUs pay a higher grid tariff per watt (see the Temperature and power section), so electricity still matters on every tier.'),
          ],
        },
        {
          id: 'silicon-lottery',
          title: 'Silicon lottery',
          keywords: ['calidad', 'quality', 'bronze', 'silver', 'gold', 'god', 'loteria', 'suerte', 'luck'],
          blocks: [
            p('Every GPU you buy (or win from a contract) comes with a random quality: **Bronze**, **Silver**, **Gold** or **Silicon God**. Quality does not change the stock hashrate: it decides how much **overclock** the chip can take, that is, its core and memory headroom and how many MHz it gains per +10 mV.'),
            table(T.qualityTable(L)),
            tip(`The ${n(whisperer.name)} talent multiplies the Gold and Silicon God odds (up to ${whisperer.format(whisperer.maxLevel)}). Getting a Silicon God unlocks the "Silicon God" achievement.`),
          ],
        },
        {
          id: 'psus',
          title: 'PSUs (power supplies)',
          keywords: ['psu', 'fuente', 'alimentacion', 'eficiencia', 'overload', 'power supply', 'efficiency'],
          blocks: [
            p('Every rack needs a PSU (except the Gold Edition). The rack **load** is the sum of its powered-on GPUs, overclock included, plus the coolers. If the load exceeds the PSU capacity, the whole rack shuts down in **PSU OVERLOAD** state.'),
            p('Efficiency decides what you pull from the wall: wall draw = load / efficiency. The difference is paid on the bill and also heats up the room.'),
            table(T.psuTable(L)),
            tip('Leave headroom: overclocking raises the draw. The rack view warns you when the PSU cannot keep up.'),
          ],
        },
        {
          id: 'coolers',
          title: 'Coolers',
          keywords: ['cooler', 'ventilador', 'fan', 'refrigeracion', 'liquida', 'inmersion', 'cryo', 'cooling', 'liquid', 'immersion'],
          blocks: [
            p('Coolers go in the rack\'s cooling slots and add heat transfer (W/°C). That cooling is shared among the GPUs mounted in the rack: more GPUs with the same coolers means less cooling for each one. Coolers only work if the rack has power, and their draw counts as PSU load.'),
            table(T.coolerTable(L)),
            info('The Tips section has a table with the minimum cooler for each GPU in each room.'),
          ],
        },
        {
          id: 'racks',
          title: 'Racks',
          keywords: ['rack', 'slots', 'bench', 'cabinet', 'gold edition'],
          blocks: [
            p('A rack groups GPUs, coolers and a PSU, and takes one pad on the room floor. Every rack has one cooler slot for every two GPU slots.'),
            table(T.rackTable(L)),
          ],
        },
        {
          id: 'install',
          title: 'Install, uninstall and Auto-fill',
          keywords: ['instalar', 'montar', 'desmontar', 'auto-fill', 'almacen', 'storage', 'vender', 'install', 'uninstall', 'sell'],
          blocks: [
            list(
              '**Install:** click a rack in the room. Drag a part from storage to a slot, or click the part and then the slot.',
              '**Uninstall:** the trash button on each slot returns the part to storage. An uninstalled GPU cools down instantly.',
              '**Auto-fill:** fills the free slots with the best you have in storage: the highest-hashrate GPUs, the strongest coolers and the biggest PSU.',
              `**Sell:** from **Rigs** you recover ${pct(SELL_REFUND)} of the price (GPUs, minus their wear). A rack can only be sold empty. The Gold Edition cannot be sold.`,
            ),
          ],
        },
      ],
    },
    {
      id: 'thermal',
      title: 'Temperature and power',
      icon: 'thermal',
      color: '#f97316',
      summary: 'Thermal model, paste, repairs, power lines and the bill.',
      entries: [
        {
          id: 'thermal-model',
          title: 'The thermal model',
          keywords: ['temperatura', 'calor', 'throttling', 'apagado', 'shutdown', 'desgaste', 'wear', 'temperature', 'heat'],
          blocks: [
            p('Every chip heats up with its power draw and cools toward the room air. It settles at an equilibrium temperature and gets there faster or slower depending on its thermal mass:'),
            formula('T_equilibrium = T_room + heat / k'),
            formula(`k = (${PHYSICS.baseCooling} + rack coolers / rack GPUs) × paste × room cooling`),
            p('Heat is the GPU\'s power draw; it rises with overclock and falls with Thermal Mastery or in a Gold Edition. The thresholds:'),
            list(
              `**Above ${PHYSICS.throttleTemp} °C: throttling.** The GPU mines at half speed.`,
              `**Above ${PHYSICS.wearTemp} °C: wear.** It loses ${pct(PHYSICS.wearPerMinute)} efficiency per minute, permanently, up to a maximum of ${pct(PHYSICS.maxWear)}.`,
              `**${PHYSICS.shutdownTemp} °C: thermal shutdown.** The GPU turns off and does not come back until it cools to ${PHYSICS.restartTemp} °C.`,
            ),
            warn(`Between ${PHYSICS.throttleTemp} and ${PHYSICS.shutdownTemp} °C you lose half the hashrate and, above ${PHYSICS.wearTemp} °C, the chip degrades. The goal is to always stay below ${PHYSICS.throttleTemp} °C.`),
          ],
        },
        {
          id: 'paste',
          title: 'Thermal paste and repaste',
          keywords: ['pasta', 'paste', 'repaste'],
          blocks: [
            p(`Thermal paste dries out while the GPU works: it lasts ${min(PHYSICS.pasteLifetimeSec)} of use. With dry paste, heat transfer drops to ${pct(PHYSICS.pasteMinFactor)}, and the chip runs ${pct(1 / PHYSICS.pasteMinFactor - 1)} hotter above the room.`),
            p('The **Paste** button on each GPU makes it new. The "paste" bar in the rack view turns yellow below 50% and red below 20%. Technicians renew it on their own.'),
            table(T.maintenanceTable(L)),
          ],
        },
        {
          id: 'repair',
          title: 'Repairs',
          keywords: ['reparar', 'repair', 'desgaste', 'wear'],
          blocks: [
            p(`Wear reduces the GPU's hashrate (up to ${pct(PHYSICS.maxWear)} less) and its resale value. The repair button (wrench) resets it to zero. It costs half the GPU price multiplied by the wear (table above). Technicians also repair wear little by little.`),
          ],
        },
        {
          id: 'ambient',
          title: 'Room temperature',
          keywords: ['ambiente', 'sala', 'aire', 'ambient', 'room', 'air'],
          blocks: [
            p('The air of each room starts at its ambient temperature and rises with all the waste heat: from the GPUs, the cooler motors and the PSU losses.'),
            formula('T_room → ambient + waste heat × room heating'),
            p(`The air takes about ${PHYSICS.roomTau} s to settle. Large rooms have a much lower heating per watt (table in Rooms). A **Summer Heatwave** adds ${EVENT_EFFECTS.heatwaveDelta} °C to every room and a **Cold Snap** subtracts ${Math.abs(EVENT_EFFECTS.coldSnapDelta)} °C.`),
          ],
        },
        {
          id: 'power',
          title: 'Power limits, brownout and overload',
          keywords: ['potencia', 'linea', 'brownout', 'overload', 'electricidad', 'power', 'line', 'electricity'],
          blocks: [
            list(
              '**PSU:** if the rack load exceeds its PSU capacity, that rack shuts down (PSU OVERLOAD).',
              '**Room line:** if the wall draw of all racks exceeds the contracted line, there is a **brownout**: every GPU in the room mines and heats in proportion to the available line. You only pay for what comes through the line.',
              '**Gold Edition:** has its own reactor. It does not use the line, pays no electricity and needs no PSU.',
            ),
            tip('A brownout breaks nothing, but you are paying for hardware that is not performing. When you see it, it is time for a new room.'),
          ],
        },
        {
          id: 'bill',
          title: 'Power bill and grid tariff',
          keywords: ['factura', 'luz', 'tarifa', 'grid', 'electricidad', 'precio', 'bill', 'tariff', 'electricity', 'price'],
          blocks: [
            formula(`bill/s = wall watts × $${PHYSICS.pricePerWattSec} × room price × (1 − Green PPA) × grid tariff`),
            p(`The **grid tariff** charges more per watt for dense hardware: it is (the model's hash per watt / the ${n(starterGpu.name)}'s hash per watt) ^ ${GRID.tariffExponent}. The ${n(starterGpu.name)} pays ×1 and the high tiers pay far more per watt. This way electricity takes a similar share of what you mine on every tier (table), and efficient PSUs, cheap rooms and Green PPA always pay off. No device runs at a loss.`),
            table(T.gridTariffTable(L)),
            info('Coolers and PSU losses are billed at the average tariff of the GPUs in their rack. The Shop tab shows each GPU\'s tariff.'),
          ],
        },
      ],
    },
    {
      id: 'bios',
      title: 'BIOS and overclock',
      icon: 'bios',
      color: '#e879f9',
      summary: 'The overclock minigame: core, memory, voltage, BSOD and Auto-Tune.',
      entries: [
        {
          id: 'bios-open',
          title: 'How to enter',
          keywords: ['bios', 'overclock', 'oc', 'teclas', 'f10', 'keys', 'keyboard'],
          blocks: [
            p('Open a rack and press **BIOS** on a GPU. It works with mouse or keyboard:'),
            list(
              '**↑ / ↓** to pick a setting and **← / →** (or + / −) to change it.',
              '**F10: Save & Stress Test.** Applies the profile after a stress test.',
              '**F5: Load Defaults.** Goes back to stock values.',
              '**F9: AI Auto-Tune**, only with the AI Self-Diagnostics VIP upgrade.',
              '**Esc** to leave.',
            ),
          ],
        },
        {
          id: 'oc-settings',
          title: 'Core, memory and voltage',
          keywords: ['core', 'memoria', 'memory', 'voltaje', 'voltage', 'mv', 'mhz'],
          blocks: [
            table(T.ocLimitsTable(L)),
            formula(`bonus = core / ${OC_LIMITS.core.max} × 25 % + memory / ${OC_LIMITS.mem.max} × 15 %   (max +${pct(OC_LIMITS.maxBonus)})`),
            formula(`power × (voltage / ${OC_LIMITS.voltage.stock})² × (1 + core / 2000) × (1 + memory / 12000)`),
            p('Raising the voltage gives no hashrate by itself: it gives the core headroom (the MHz per +10 mV depend on the chip quality). But the power draw grows with the square of the voltage, and with it the heat and the bill.'),
          ],
        },
        {
          id: 'bsod',
          title: 'BSOD risk',
          keywords: ['bsod', 'crash', 'pantallazo', 'riesgo', 'estable', 'risk', 'stable', 'blue screen'],
          blocks: [
            p('Every chip has a hidden core and memory headroom, which depends on its quality. When you press F10:'),
            list(
              'If you exceed the core headroom (with the voltage extra) or the memory one, the chip definitely crashes.',
              'If you stay within 15 MHz of the core limit or within 60 MHz of the memory limit, there is a 35% chance of a crash.',
              'With more margin, the test is always stable.',
            ),
            p(`A crash is a **BSOD**: the overclock is not applied and the whole rack reboots for ${min(PHYSICS.rebootMs / 1000)}. The BIOS risk indicator is an estimate with about ±30 MHz of error: the real headroom is never shown.`),
            tip('Raise in small steps and keep the last stable profile. Five stable overclocks unlock the "Overclock Artisan" achievement; the first BSOD, "Blue Screen Veteran".'),
          ],
        },
        {
          id: 'autotune',
          title: 'Auto-Tune',
          keywords: ['auto-tune', 'autotune', 'ia', 'ai', 'diagnostics'],
          blocks: [
            p(`With **AI Self-Diagnostics** (${VIP_COSTS.aiDiagnostics} gems), F9 instantly applies a profile with no crash risk: ${autoTuneVoltage} mV, the core 25 MHz from its limit and the memory 90 MHz from its own. The bonus depends on quality (Auto-Tune column of the silicon lottery).`),
            warn(`The profile uses ${autoTuneVoltage} mV: from the voltage alone, the GPU draws and heats ${pct(ocPowerMul({ core: 0, mem: 0, voltage: autoTuneVoltage }) - 1)} more (and somewhat more from the extra MHz). Check the temperature and the PSU after applying it.`),
          ],
        },
      ],
    },
    {
      id: 'rooms',
      title: 'Rooms',
      icon: 'rooms',
      color: '#fbbf24',
      summary: 'Ambient, power line, pads, electricity price and cooling of each room.',
      entries: [
        {
          id: 'room-list',
          title: 'The rooms',
          keywords: ['sala', 'room', 'bedroom', 'garage', 'warehouse', 'arctic', 'submarine'],
          blocks: [
            p('Every room adds pads for racks, a bigger power line, cheaper electricity and a better thermal environment. They are bought in order in **Shop → Rooms**, and each one needs the previous one.'),
            table(T.roomTable(L)),
            info(`The ${n(garage.name)} is a thermal trap: ${garage.ambient} °C ambient. It suits low tiers with good coolers, but expensive hardware performs better in cold rooms.`),
          ],
        },
        {
          id: 'move-racks',
          title: 'Placing and moving racks',
          keywords: ['mover', 'colocar', 'pad', 'almacen', 'storage', 'move', 'place'],
          blocks: [
            steps(
              'Switch rooms with the buttons above the view.',
              'Click an empty pad and pick a rack from storage.',
              'To move it to another room: open it, press **Move to storage** (everything mounted is kept), switch rooms and place it on a free pad.',
            ),
            p(`The VIP Floor Plans talent adds one pad to every room per level, up to a maximum of ${MAX_PADS} pads per room. The Halving sends the rooms back to the ${n(bedroom.name)}, unless you have Real Estate Trust.`),
          ],
        },
      ],
    },
    {
      id: 'crew',
      title: 'Technicians and maintenance',
      icon: 'crew',
      color: '#38bdf8',
      summary: 'What technicians do, what they cost and how many GPUs they cover.',
      entries: [
        {
          id: 'technicians',
          title: 'Technicians',
          keywords: ['tecnico', 'technician', 'crew', 'mantenimiento', 'contratar', 'maintenance', 'hire'],
          blocks: [
            p(`They are hired in **Shop → Crew**, up to ${MAX_TECHNICIANS}. The first costs ${formatCash(TECHNICIAN_BASE_COST)} and each extra one costs ×${TECHNICIAN_COST_GROWTH}. They walk around the room and, without you doing anything, on all mounted GPUs:`),
            list(
              `**Renew the paste:** each technician refills a dry paste in ${min(1 / PHYSICS.techPastePerSec)}.`,
              `**Repair wear:** each technician removes ${pct(PHYSICS.techWearRepairPerSec * 60, 1)} of wear per minute, faster than a chip degrades above ${PHYSICS.wearTemp} °C.`,
            ),
            p(`They work at full pace with up to ${TECH_FULL_SPEED_GPUS} mounted GPUs. With more, the work is shared. Even so, a single technician keeps the paste of about ${gpusPerTechPaste} GPUs at 100%. Tech Union gives free technicians at the start of every run and makes them faster (+${pct(TALENT_BY_ID.tech_union.effect)} per level).`),
            table(T.technicianTable(L)),
            info('Technicians are lost with The Halving (except the ones Tech Union gives).'),
          ],
        },
        {
          id: 'manual-maintenance',
          title: 'Manual maintenance',
          keywords: ['repaste', 'reparar', 'repair'],
          blocks: [
            p(`Without technicians you have to repaste and repair by hand from the rack view. Repasting is cheap (${pct(T.repasteShare())} of the GPU price) and worth doing before the bar drops below 50%. Repairing pays off on expensive or heavily worn GPUs.`),
          ],
        },
      ],
    },
    {
      id: 'pools',
      title: 'Pools and network',
      icon: 'pools',
      color: '#4ade80',
      summary: 'Public, Solo and Darknet pools, raids, network events and difficulty.',
      entries: [
        {
          id: 'pool-modes',
          title: 'Mining pools',
          keywords: ['pool', 'solo', 'public', 'darknet', 'comision', 'fee'],
          blocks: [
            p('In the **Pools** tab you choose where the whole farm mines. You can switch whenever you want if you have the level.'),
            table(T.poolTable(L)),
            list(
              `**${n(POOLS.public.name)}:** you are paid continuously and the pool keeps ${pct(publicFee)}.`,
              `**${n(POOLS.solo.name)}:** you get nothing until you find a block. On average there is one every ${min(PHYSICS.soloBlockMeanSec)} and it pays that much mining time with a +${pct(PHYSICS.soloEvMul - 1)}. It may also drop a gem. It is more profitable in the long run, but in streaks.`,
              `**${n(POOLS.darknet.name)}:** +${pct(POOLS.darknet.payoutMul - 1)} payout, but with raids.`,
            ),
          ],
        },
        {
          id: 'raids',
          title: 'Raids and electrical inspections',
          keywords: ['redada', 'raid', 'multa', 'inspeccion', 'darknet', 'fine', 'inspection'],
          blocks: [
            p(`On the Darknet there is a raid every ~${min(PHYSICS.darknetRaidMeanSec)} on average. In each raid:`),
            list(
              'You are fined 12% of your cash or the value of 90 s of mining, whichever is greater, never more than you have.',
              `An inspector checks one of your rooms at random and all its racks shut down for ${min(PHYSICS.inspectionRebootMs / 1000)}.`,
            ),
            tip('Raids punish hoarded cash. Spend it beforehand or store the value in $CC. There are no raids offline. The first one unlocks the "Wanted" achievement.'),
          ],
        },
        {
          id: 'events',
          title: 'Network events',
          keywords: ['evento', 'event', 'blackout', 'heatwave', 'apagon'],
          blocks: [
            p(`While you play, every ${EVENT_INTERVAL[0]}–${EVENT_INTERVAL[1]} s (after the previous one ends) a network event arrives. There are no events offline.`),
            table(T.eventTable(L)),
            tip('Before a Summer Heatwave it pays to have thermal headroom. A thermal shutdown during an event fails the Storm Watch contract.'),
          ],
        },
        {
          id: 'mined-coin',
          title: 'Which coin you mine',
          keywords: ['moneda', 'byt', 'nova', 'altcoin', 'bytecoin', 'minar', 'elegir', 'coin'],
          blocks: [
            p('In the **Pools** tab you choose the coin your farm mines: **$CC**, **$BYT** or **$NOVA**. It mines one at a time and every pool pays that coin. Each one has its own price, wallet and market.'),
            table(T.altcoinTable(L)),
            list(
              `**$BYT:** steady (volatility ${COIN_MARKET.BYT.sigma} against ${COIN_MARKET.CC.sigma} for $CC), fixed difficulty and ${pct(MINEABLE.BYT.valueMul)} pay. A Bull Run barely moves it and a Difficulty Spike only raises its difficulty to ×${EVENT_EFFECTS.bytDifficultyMul}.`,
              `**$NOVA:** volatile (${COIN_MARKET.NOVA.sigma}) with ${pct(MINEABLE.NOVA.valueMul)} pay, but its difficulty grows with your own hashrate: at ${formatHashrate(1e9)} it is ×1 and at ${formatHashrate(1e12)} it is already ×${hashDifficulty('NOVA', 1e12).toFixed(1)}. It beats $CC for small farms and falls behind it for huge ones.`,
              'Mined coins cost nothing: selling them is entirely profit. All three are bought and sold in Market and trading bots can trade them.',
              '"Mine $CC" contracts only advance while you mine $CC. Coins are lost at The Halving, but the market and bots are kept.',
            ),
            tip('The Pools tab shows, for every coin, what you would mine per second and its value right now: pick the highest, or the steadiest if you want no surprises.'),
          ],
        },
        {
          id: 'difficulty',
          title: 'Difficulty',
          keywords: ['dificultad', 'difficulty', 'recompensa', 'reward'],
          blocks: [
            formula(`coins/s = MH/s × ${PHYSICS.rewardPerMHs} (in $CC) / difficulty × pool payout`),
            p(`The base difficulty is 1 and does not grow over time. It only changes during a **Difficulty Spike** (×${EVENT_EFFECTS.difficultyMul}) and, for $NOVA, with your own hashrate. Your hashrate is the only thing that makes income grow.`),
          ],
        },
      ],
    },
    {
      id: 'market',
      title: 'Market',
      icon: 'market',
      color: '#22c55e',
      summary: '$CC, $BYT, $NOVA and $MEME, buying and selling, fees, cost basis and trading bots.',
      entries: [
        {
          id: 'coins',
          title: 'The four coins',
          keywords: ['cc', 'meme', 'byt', 'nova', 'precio', 'moneda', 'coin', 'price'],
          blocks: [
            list(
              `**$CC:** the coin you mine. Base price $${MARKET.cc.base}. It fluctuates with a tendency to return to the base, between ×${MARKET.cc.min} and ×${MARKET.cc.max}. A Bull Run pushes it toward ×${EVENT_EFFECTS.bullMeanMul}.`,
              `**$BYT:** mineable and steady. Base price $${MARKET.byt.base}, between ×${MARKET.byt.min} and ×${MARKET.byt.max}. A Bull Run pushes it only toward ×${EVENT_EFFECTS.bytBullMeanMul}.`,
              `**$NOVA:** mineable and volatile. Base price $${MARKET.nova.base}, between ×${MARKET.nova.min} and ×${MARKET.nova.max}. A Bull Run pushes it toward ×${EVENT_EFFECTS.bullMeanMul}.`,
              `**$MEME:** can only be bought. Base price $${MARKET.meme.base}, much more volatile (×${MARKET.meme.min} to ×${MARKET.meme.max}), with sudden pumps and dumps while you play. Meme Mania blows up its volatility.`,
            ),
            p('The terminal chart shows 5 s candles.'),
          ],
        },
        {
          id: 'trade',
          title: 'Buying and selling',
          keywords: ['comprar', 'vender', 'buy', 'sell', 'comision', 'fee'],
          blocks: [
            p(`In **Market** you sell 25%, 50% or 100% of a coin, and buy with 10%, 25% or 50% of your cash or with an exact amount. Buying pays the price + ${pct(MARKET.fee, 1)} and selling collects the price − ${pct(MARKET.fee, 1)}. Insider Ticker raises the selling price by 3% per level.`),
          ],
        },
        {
          id: 'cost-basis',
          title: 'Cost basis: what counts as profit',
          keywords: ['coste', 'cost basis', 'beneficio', 'ganancias', 'earnings', 'profit', 'cost'],
          blocks: [
            p('The game remembers how much you paid for the coins you hold (their **cost basis**). When you sell, only what you collect **above** the proportional part of that cost counts as profit:'),
            list(
              'Mined coins ($CC, $BYT, $NOVA) cost nothing: selling them is entirely profit.',
              'Buying and selling the same coin only adds the real profit, if any. Losses do not subtract, but "wash trading" does not raise your level.',
              'Contract prizes are a gift: they give cash, but do not count as earnings.',
            ),
            info('Run earnings and lifetime earnings only count realized profit. They are what decides the level, The Halving and the money achievements.'),
          ],
        },
        {
          id: 'bots',
          title: 'Trading bots',
          keywords: ['bot', 'trading', 'automatico', 'regla', 'automatic', 'rule'],
          blocks: [
            p(`They unlock at **level ${BOT_UNLOCK_LEVEL}**. You can have up to ${MARKET.maxBots}. Each bot is a rule:`),
            list(
              'Coin ($CC, $BYT, $NOVA or $MEME) and operation (buy or sell).',
              'Trigger: price **above** or **below** a multiple of its base price (for example, 1.15 = 15% over the base).',
              'Amount: % of what you hold of that coin (sell) or of your cash (buy).',
              'Minimum wait in seconds between triggers.',
            ),
            p('A new bot sells 100% of $CC above ×1.15, with a 20 s wait. Bots keep trading during offline progress and survive The Halving. Their sales of mined $CC count as profit (and toward the Algo Desk contract).'),
            tip(`The Peak Auto-Seller VIP sells all your $CC as soon as the price passes ×${MARKET.vipPeakThreshold}.`),
          ],
        },
      ],
    },
    {
      id: 'contracts',
      title: 'Contracts',
      icon: 'contracts',
      color: '#fb923c',
      summary: 'The job board: types, rewards and rerolls.',
      entries: [
        {
          id: 'board',
          title: 'How the board works',
          keywords: ['contrato', 'contract', 'tablon', 'encargo', 'mision', 'board', 'mission'],
          blocks: [
            p(`The **Contracts** tab holds ${CONTRACTS.slots} jobs at a time, generated from your hashrate, your income and your GPUs. Each has a deadline. When completed it becomes ready to claim and no longer expires. If the deadline runs out, it expires. ${CONTRACTS.refillSec} s after a slot empties, a new contract arrives.`),
            table(T.contractKindTable(L)),
            list(
              'Money goals only count realized profit over cost. Delivered $CC must be mined.',
              `Cold Chain requires keeping at least ${pct(CONTRACTS.keepCoolMinHashShare)} of the hashrate you had when you accepted, and the streak lasts ${KEEP_COOL_STREAK_MIN.join(' / ')} min depending on difficulty.`,
              'Offline time adds proportionally up to the deadline, but resets the Cold Chain streak and voids the event Storm Watch was watching.',
            ),
          ],
        },
        {
          id: 'rewards',
          title: 'Rewards',
          keywords: ['recompensa', 'premio', 'gema', 'gpu gratis', 'reward', 'prize', 'gem', 'free gpu'],
          blocks: [
            p('Cash is a share of what your farm would earn during the deadline, so it is always at your scale. Higher difficulties may give gems and free GPUs, which come with their silicon lottery.'),
            table(T.contractDifficultyTable(L)),
          ],
        },
        {
          id: 'reroll',
          title: 'Rerolls',
          keywords: ['reroll', 'cambiar', 'descartar', 'change', 'discard'],
          blocks: [
            p(`You can swap an active contract for a new one once every ${min(CONTRACTS.rerollCooldownSec)}. It costs about ${min(CONTRACTS.rerollIncomeSec)} of your estimated net income (minimum ${formatCash(CONTRACTS.rerollMinCost)}). The Halving deals a new board scaled to the run.`),
          ],
        },
      ],
    },
    {
      id: 'halving',
      title: 'The Halving and talents',
      icon: 'halving',
      color: '#facc15',
      summary: 'When to do it, how many $SC it gives, what is kept and the talent tree.',
      entries: [
        {
          id: 'halving-unlock',
          title: 'When it unlocks',
          keywords: ['halving', 'prestigio', 'reinicio', 'reset', 'sc', 'prestige'],
          blocks: [
            p(`The Halving becomes available in the **Halving** tab when the run earnings (realized profit only) reach **${formatCash(HALVING_MIN_EARNINGS)}**. When you confirm it, the farm resets and you take away $SC and +${T.HALVING_GEMS} gems.`),
          ],
        },
        {
          id: 'sc-formula',
          title: 'The $SC formula',
          keywords: ['formula', 'recompensa', 'smart contracts', 'hitos', 'reward', 'milestones'],
          blocks: [
            p(`At the threshold you earn ${HALVING_BASE_SC} $SC. Each extra $SC costs multiplying the earnings by ×2, ×3, ×4…: ${formatCash(earningsForSc(HALVING_BASE_SC + 1))} gives ${HALVING_BASE_SC + 1}, ${formatCash(earningsForSc(HALVING_BASE_SC + 2))} gives ${HALVING_BASE_SC + 2}, ${formatCash(earningsForSc(HALVING_BASE_SC + 3))} gives ${HALVING_BASE_SC + 3}…`),
            table(T.scMilestoneTable(8, L)),
          ],
        },
        {
          id: 'sc-peak',
          title: 'The $SC/h peak: pick your moment',
          keywords: ['pico', 'peak', 'momento', 'cuando', 'sc/h', 'moment', 'when'],
          blocks: [
            p('A run\'s earnings grow very fast, but $SC grows slower and slower. That is why the **$SC per run hour** rise a little after the threshold, reach a peak and then fall: waiting longer gives more $SC per run, but fewer per hour.'),
            p(`In the table's example, the peak is at ${peak.sc} $SC, around ${formatDuration(peak.hours * 3600)} into the run (${peak.scPerHour.toFixed(2)} $SC/h). The Halving tab shows your real pace ($SC / HOUR), the next goal (NEXT $SC AT) and a progress bar.`),
            tip('Rule of thumb: do The Halving shortly after crossing a milestone, when the next one is too far away for your current pace. Every talent you buy makes the next run faster and moves the peak earlier.'),
          ],
        },
        {
          id: 'reset',
          title: 'What resets and what is kept',
          keywords: ['reinicia', 'conserva', 'pierdo', 'mantiene', 'reset', 'keep', 'lose'],
          blocks: [
            p('**Resets:**'),
            list(
              `Cash (you go back to ${formatCash(STARTING_CASH)} + Seed Capital), $CC, $BYT, $NOVA and $MEME. The mined coin goes back to $CC.`,
              `All regular hardware: GPUs, PSUs, coolers and racks. You return to the starter rig in the ${n(bedroom.name)}.`,
              'Rooms (unless you have Real Estate Trust), technicians, pool (back to Public), contracts and run earnings.',
            ),
            p('**Kept:**'),
            list(
              '$SC, talents, gems, VIP upgrades, achievements and completed challenges.',
              'Gold Edition Racks, empty and in storage.',
              'Trading bots, the market, lifetime earnings (your level), statistics and settings.',
            ),
          ],
        },
        {
          id: 'challenges',
          title: 'Challenge runs',
          keywords: ['reto', 'desafio', 'challenge', 'restriction', 'bonus', 'no overclock', 'bronze', 'single room', 'power cap'],
          blocks: [
            p(`When you trigger The Halving or start a new game you can pick an optional **challenge**: a restriction that lasts the whole run. If you reach the Halving threshold (${formatCash(HALVING_MIN_EARNINGS)} of earnings) with the restriction held, you are paid extra $SC and gems right away and the restriction is lifted.`),
            table(T.challengeTable(L)),
            list(
              'The **first clear** of each challenge pays the full bonus; later clears pay the repeat bonus. Your best time is recorded.',
              'Forbidden actions are refused with a warning in the log (for example the BIOS under No Overclock); the active challenge shows in the top bar with your progress.',
              'You can **abandon** the challenge from the top bar or the Halving tab: the run goes on unrestricted and keeps the normal Halving reward, without the challenge bonus.',
              'Completed challenges and best times are listed in the Halving tab and survive Halvings. Starting a new game wipes them with the rest of your progress.',
            ),
            tip('No Overclock and Bronze Only barely slow you down: good for starting out. Single Room is the serious one: all the profit comes from two pads and a 1.5 kW line, so favor hashrate per watt.'),
          ],
        },
        {
          id: 'talents',
          title: 'Talent tree',
          keywords: ['talento', 'talent', 'arbol', 'tree', 'smart contract'],
          blocks: [
            p('$SC is spent in the tree in the Halving tab. Each level costs a bit more than the previous one, and a talent unlocks when all its requirements have at least one level.'),
            table(T.talentTable(L)),
            tip('Hash Amplifier first: it is the root and multiplies everything. Seed Capital and Tech Union speed up the start of each run, and Quantum Entangle is the big final expense.'),
          ],
        },
      ],
    },
    {
      id: 'vip',
      title: 'VIP and gems',
      icon: 'vip',
      color: '#e879f9',
      summary: 'Where gems come from and what they buy.',
      entries: [
        {
          id: 'gems',
          title: 'Gem sources',
          keywords: ['gema', 'gem', 'conseguir', 'get', 'earn'],
          blocks: [
            p('Gems cannot be bought with real money: they are earned by playing and are not lost with The Halving.'),
            table(T.gemSourceTable(L)),
          ],
        },
        {
          id: 'ai-manager',
          title: 'AI Farm Manager',
          keywords: ['ia', 'ai', 'gestor', 'manager', 'autopilot', 'piloto', 'automatico', 'algoritmo', 'bot'],
          blocks: [
            p(`In the **VIP** tab the **AI Farm Manager** runs the whole farm for a while: ${AUTOPILOT_PLANS.map((x) => `${x.label} for ${x.gems} gems`).join(', ')}. Plans stack up to ${min(AUTOPILOT.maxSeconds)}. Its time only runs while the game is open and stops while it is paused, so none is wasted; it survives The Halving.`),
            steps(
              'Chores, every second and a half: it catches drones, claims goals, the daily bonus and finished contracts, places stored racks, mounts spare parts, renews dry paste, repairs badly worn cards and fuses spare GPUs in the Forge.',
              `Coins: it mines whichever coin pays at least ${pct(AUTOPILOT.coinSwitchGain - 1)} more, and sells what you mine when the price is at its recent average or better, when the wallet is worth more than ${min(AUTOPILOT.maxHoldSec)} of income, or when the cash is needed for a purchase.`,
              `Candidates, every ${AUTOPILOT.planEveryMs / 1000} s: a card in a free slot, a better card in place of the weakest one, a new rack, the next room with its first rack, more cooling for a rack that runs hot and every Lab project. Each one comes with the PSU and cooler it needs to hold ${AUTOPILOT.targetTemp} °C.`,
              `Simulation: every candidate is tried on a copy of your farm with the game's own physics for ${min(AUTOPILOT.simSeconds)}, so heat, throttling, overloads, brownouts and tariffs all count. The extra net income is its gain.`,
              'Decision: the target is the candidate with the lowest payback time plus time to save for it. It is bought as soon as there is cash. While saving, it only buys something cheaper if that pays for itself before the target would be reached.',
            ),
            formula('score = cost / gain + max(0, cost − cash) / net income'),
            list(
              `It keeps ${min(AUTOPILOT.reserveBillSec)} of electricity bill in reserve and never buys anything that takes more than ${min(AUTOPILOT.maxPaybackSec)} to pay for itself.`,
              'It never spends gems or $SC, never touches $MEME or your trading bots, never rerolls contracts and never triggers The Halving: those stay your decisions.',
              'With AI Self-Diagnostics it also applies the safe Auto-Tune overclock to cool cards whose PSU has room.',
            ),
            tip('A manager hour is worth the most right after The Halving, when there is a whole farm to rebuild.'),
          ],
        },
        {
          id: 'vip-shop',
          title: 'VIP shop',
          keywords: ['vip', 'gold edition', 'auto-tune', 'auto-seller'],
          blocks: [
            p('The **VIP** tab exchanges gems for permanent upgrades:'),
            table(T.vipTable(L)),
            tip(`A Gold Edition Rack with high-tier GPUs saves a fortune in electricity and does not use up the room line. It is the best long-term purchase (${VIP_COSTS.goldRack} gems).`),
          ],
        },
      ],
    },
    {
      id: 'lab',
      title: 'Lab, goals and drones',
      icon: 'lab',
      color: '#c084fc',
      summary: 'Research, the roadmap, supply drones, the daily bonus and the Silicon Forge.',
      entries: [
        {
          id: 'research',
          title: 'Research Lab',
          keywords: ['laboratorio', 'investigacion', 'research', 'lab', 'firmware', 'i+d'],
          blocks: [
            p('The **Lab** tab sells upgrades for the whole run. You pay cash, the project takes real time and its bonus then applies to the entire farm. Projects keep running while the game is closed.'),
            table(T.researchTable(L)),
            list(
              'Only one project runs at a time. Each level costs and takes more than the previous one.',
              `**Rush** finishes it at once for gems: 1 gem per ${min(RUSH_SECONDS_PER_GEM)} left (rounded up).`,
              '**Cancel** returns the full cost: you only lose the time.',
              `The ${n(TALENT_BY_ID.lab_grant.name)} talent shortens every project by ${pct(TALENT_BY_ID.lab_grant.effect)} per level.`,
              'Line Upgrade does nothing during the Power Cap and Single Room challenges.',
            ),
            warn('The Halving wipes the Lab: levels and the running project are lost. Finish what you started before resetting.'),
          ],
        },
        {
          id: 'roadmap',
          title: 'Roadmap',
          keywords: ['objetivo', 'meta', 'goal', 'roadmap', 'hoja de ruta', 'tutorial', 'guia'],
          blocks: [
            p(`The bar under the top panel shows your current **goal**, how far along you are and its reward. There are ${ROADMAP.length} goals that walk you through every system of the game, in order. When one is met, press **Claim**; **Go** opens the panel where it is done.`),
            table(T.roadmapTable(L)),
            info('Goal cash is a gift: like contract prizes, it does not count as earnings for levels or The Halving. The full list lives in the Trophies tab, next to the session charts.'),
          ],
        },
        {
          id: 'drones',
          title: 'Supply drones and Overdrive',
          keywords: ['dron', 'drone', 'airdrop', 'caja', 'crate', 'overdrive', 'suministros'],
          blocks: [
            p(`Every ${AIRDROP.interval[0]}–${AIRDROP.interval[1]} s a **supply drone** crosses the room with a mystery crate. It stays ${AIRDROP.lifetimeSec} s: click it (or the **Catch the drone** button) before it leaves.`),
            table(T.airdropTable(L)),
            list(
              `**Overdrive** multiplies the hashrate of the whole farm by ${AIRDROP.overdriveMul}. More hashrate also means more heat and power draw, so leave some headroom.`,
              `The ${n(TALENT_BY_ID.drone_uplink.name)} talent makes every crate ${pct(TALENT_BY_ID.drone_uplink.effect)} bigger per level (longer Overdrive too).`,
              'Drones only come while you play: none arrive offline.',
            ),
          ],
        },
        {
          id: 'daily',
          title: 'Daily bonus',
          keywords: ['diario', 'daily', 'racha', 'streak', 'regalo', 'gift'],
          blocks: [
            p('The gift button on the goal bar opens the **daily bonus**: one claim per calendar day. Consecutive days climb a 7-day ladder; skipping a day sends you back to day 1.'),
            table(T.dailyTable(L)),
          ],
        },
        {
          id: 'forge',
          title: 'Silicon Forge and bulk buying',
          keywords: ['forja', 'forge', 'fusionar', 'fuse', 'cantidad', 'bulk', 'x10', 'autocompletar'],
          blocks: [
            p('In **Rigs → Silicon Forge** you melt 3 spare GPUs (not mounted in a rack) of the same model and grade into 1 of the next grade: Bronze → Silver → Gold → Silicon God. The new card has fresh paste, no wear and its own freshly rolled overclock headroom.'),
            list(
              'The most worn units are used first.',
              'The Forge is closed during the Bronze Only challenge.',
              'The Shop has a quantity selector (x1, x5, x10, MAX): bulk GPU purchases roll the Silicon Lottery for every card and summarise the result.',
              '**Auto-fill all** mounts the best spare parts in every placed rack, and **Re-paste all** renews the paste of every mounted GPU below 60%.',
            ),
            tip('Buying cheap cards in bulk and fusing the Bronze ones is a reliable way to get Gold silicon for overclocking.'),
          ],
        },
      ],
    },
    {
      id: 'trophies',
      title: 'Achievements',
      icon: 'trophies',
      color: '#facc15',
      summary: 'All the achievements and their gems.',
      entries: [
        {
          id: 'achievement-list',
          title: 'Achievement list',
          keywords: ['logro', 'achievement', 'trofeo', 'trophy'],
          blocks: [
            p('Achievements are checked automatically and shown in the **Trophies** tab. Each one gives gems once.'),
            table(T.achievementTable(L)),
          ],
        },
      ],
    },
    {
      id: 'save',
      title: 'Offline progress and saving',
      icon: 'save',
      color: '#a5b4fc',
      summary: 'Offline earnings, autosave, export and import, and the cloud.',
      entries: [
        {
          id: 'offline',
          title: 'Offline progress',
          keywords: ['offline', 'ausente', 'cerrar', 'night shift', 'away', 'close'],
          blocks: [
            p(`If you close the game, when you come back the time you were away is simulated, up to **${BASE_OFFLINE_HOURS} h** (+${nightShift.effect} h per Night Shift level, maximum ${maxOfflineHours} h). The same happens if the computer suspends with the game open. When you return you will see a report of what was mined.`),
            list(
              'Offline there are no network events, raids or $MEME pumps.',
              'Only Solo Mining pays its expected average instead of single blocks.',
              'Temperatures, paste, the bill and the bots keep working.',
              'You can turn it off in **System → Offline earnings**.',
            ),
            warn(`If a GPU overheats while you are away, it will do so for hours. Before leaving, keep the farm below ${PHYSICS.throttleTemp} °C.`),
          ],
        },
        {
          id: 'autosave',
          title: 'Local autosave',
          keywords: ['guardar', 'save', 'autoguardado', 'localstorage', 'autosave'],
          blocks: [
            p('The game saves itself in the browser (localStorage) every 2 s, and also when you switch tabs or close it. In **System** there is **Save now** to force it.'),
          ],
        },
        {
          id: 'export',
          title: 'Export and import',
          keywords: ['exportar', 'importar', 'export', 'import', 'sha-256', 'backup', 'copia'],
          blocks: [
            p('In **System** you can **Export** (copies a code to the clipboard), **Download** (saves it as a .txt), **Load file**, or paste a code and **Import pasted save**. The code is Base64 JSON signed with **SHA-256**: if it is edited or corrupted, it is rejected on import.'),
            tip('Export now and then as a backup, especially if you play as a guest.'),
          ],
        },
        {
          id: 'cloud',
          title: 'Account and cloud save',
          keywords: ['nube', 'cloud', 'cuenta', 'account', 'miner pass', 'suscripcion', 'invitado', 'guest', 'subscription'],
          blocks: [
            p('In the **Account** tab you can create a free account with email and password. Cloud saving needs the **Miner Pass** subscription (monthly or yearly; the current price is shown in Account). With the pass active, the game is uploaded every 3 minutes and when you leave the tab, and follows you to any device.'),
            list(
              'Downloading a save that is already in the cloud is free even if the pass has expired.',
              'If another device saved earlier, the game asks which progress to keep.',
              '**As a guest (no account) it is only saved in this browser.** If you clear its data or switch computers, you lose the save, unless you exported it.',
            ),
          ],
        },
      ],
    },
    {
      id: 'tips',
      title: 'Tips / FAQ',
      icon: 'tips',
      color: '#a3e635',
      summary: 'Practical tips and quick answers.',
      entries: [
        {
          id: 'cooling-guide',
          title: 'Which cooler does each GPU need?',
          keywords: ['cooler', 'refrigeracion', 'que cooler', 'recomendado', 'tier', 'cooling', 'recommended'],
          blocks: [
            p(`Calculated with the game's own thermal model, for a packed room. If a cell goes above ${PHYSICS.throttleTemp - 5} °C, there is little margin left for a Summer Heatwave (+${EVENT_EFFECTS.heatwaveDelta} °C) or for dry paste.`),
            table(T.coolingGuideTable(L)),
            info('It matches the balance tests: a Warehouse full of Hydra S9 needs Immersion Tank (with Liquid AIO 360 it throttles), and an Arctic Datacenter full of Singularity Core needs Cryo Phase-Change.'),
          ],
        },
        {
          id: 'tips-list',
          title: 'Quick tips',
          keywords: ['consejo', 'tip', 'truco', 'trick'],
          blocks: [
            list(
              `**Always below ${PHYSICS.throttleTemp} °C.** Above it you lose half the hashrate, and from ${PHYSICS.wearTemp} °C the chip wears out forever.`,
              '**Repaste before 50%.** Or hire a technician, who looks after the paste of dozens of GPUs.',
              '**Sell often.** Your level and The Halving only count what you sold.',
              '**Leave PSU headroom** before overclocking. A PSU OVERLOAD shuts the whole rack down.',
              '**Watch for brownouts.** If the room line cannot give more, the next room is a better deal than another GPU.',
              `**Switch to Solo** as soon as you reach level ${POOLS.solo.unlockLevel} if you can stand the streaks: it pays +${pct(PHYSICS.soloEvMul - 1)} on average and gives gems.`,
              '**Darknet** pays off with little cash on hand. With lots of cash, the fines hurt.',
              `**The Halving** shortly after a $SC milestone, near the $SC/h peak. For the first one, aim for ${HALVING_BASE_SC + 1}–${peak.sc} $SC.`,
            ),
          ],
        },
        {
          id: 'faq',
          title: 'Frequently asked questions',
          keywords: ['faq', 'pregunta', 'ayuda', 'por que', 'question', 'help', 'why'],
          blocks: [
            p('**Why is my level not going up?** Your level only counts realized profit: sell your $CC.'),
            p(`**My GPU says THROTTLED or SHUTDOWN.** It is too hot. Fit better coolers, repaste, remove GPUs from the rack or move it to a colder room. After a shutdown it comes back on its own once it drops below ${PHYSICS.restartTemp} °C.`),
            p('**The rack says PSU OVERLOAD.** The PSU cannot take the load. Fit a bigger PSU, remove GPUs or lower the overclock.'),
            p('**Why is my bill so high?** The grid tariff charges more per watt for expensive hardware. Use efficient PSUs, rooms with cheap electricity (power price) and the Green PPA talent.'),
            p('**Do I lose bots or gems with The Halving?** No. Bots, gems, VIP, talents, achievements and Gold Edition Racks are kept.'),
            p('**Can I play without an account?** Yes. The game is saved in this browser. Export now and then just in case.'),
          ],
        },
      ],
    },
  ];
}
