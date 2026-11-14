import type { Dict } from '..';
import { PRESTIGE_TREE } from '../../config/prestigeTree';

/**
 * Spanish for the human-readable strings that live in `src/config` (catalogs, pools, events,
 * achievements, talents, contracts). Components call `t(model.name)` at render time.
 */

const hardware: Dict = {
  // GPUs (proper product names stay, descriptive ones are translated)
  'PX-460': 'PX-460',
  'PX-580': 'PX-580',
  'VX-2070': 'VX-2070',
  'VX-3080 Ti': 'VX-3080 Ti',
  'A100 Tensor': 'A100 Tensor',
  'QB-9 Qubit': 'QB-9 Qubit',
  'Hydra S9': 'Hydra S9',
  'Leviathan X': 'Leviathan X',
  'Prism Photonic': 'Prism Fotónico',
  'Singularity Core': 'Núcleo de Singularidad',
  // PSUs
  'Bronze 500W': 'Bronce 500W',
  'Silver 1000W': 'Plata 1000W',
  'Gold 2000W': 'Oro 2000W',
  'Platinum 5kW': 'Platino 5kW',
  'Titanium 12kW': 'Titanio 12kW',
  'Fusion Busbar 30kW': 'Barra de Fusión 30kW',
  // Coolers
  '80mm Case Fan': 'Ventilador de caja 80mm',
  '120mm Turbo Fan': 'Ventilador Turbo 120mm',
  'Tower Heatsink': 'Disipador de torre',
  'Liquid AIO 360': 'Refrigeración líquida AIO 360',
  'Immersion Tank': 'Tanque de inmersión',
  'Cryo Phase-Change': 'Cambio de fase criogénico',
  // Racks
  'Open-Air Bench': 'Banco al aire libre',
  'Steel Rack 4U': 'Rack de acero 4U',
  'Server Cabinet 42U': 'Armario de servidores 42U',
  'Gold Edition Rack': 'Rack Gold Edition',
  // Silicon quality
  Bronze: 'Bronce',
  Silver: 'Plata',
  Gold: 'Oro',
  'Silicon God': 'Dios del Silicio',
};

const rooms: Dict = {
  Bedroom: 'Dormitorio',
  'Mom says the PC is too loud': 'Mamá dice que el PC hace demasiado ruido',
  Garage: 'Garaje',
  'Summer heat: +35°C ambient': 'Calor de verano: +35°C de ambiente',
  'Industrial Warehouse': 'Almacén industrial',
  'Three-phase power & ceiling fans': 'Corriente trifásica y ventiladores de techo',
  'Arctic Datacenter': 'Centro de datos ártico',
  'Free cooling at -10°C': 'Refrigeración gratis a -10°C',
  'Submarine Datacenter': 'Centro de datos submarino',
  'Ocean-cooled hull, 4°C': 'Casco refrigerado por el océano, 4°C',
};

const pools: Dict = {
  'Public Stable Pool': 'Pool público estable',
  'Steady shares': 'Shares constantes',
  'Constant payouts for every valid share. The pool keeps a 2% fee.': 'Pagos constantes por cada share válido. El pool se queda una comisión del 2%.',
  'Solo Mining': 'Minería en solitario',
  'Jackpot or nothing': 'Jackpot o nada',
  'Zero income between blocks, but every block found pays a massive jackpot (+15% EV) and may drop a gem.': 'Cero ingresos entre bloques, pero cada bloque encontrado paga un jackpot enorme (+15% de valor esperado) y puede soltar una gema.',
  'Darknet Anon Pool': 'Pool anónimo Darknet',
  'Unregulated coins': 'Monedas sin regular',
  '+75% yield on unregulated coins, but random fines and electrical inspections shut your rigs down.': '+75% de rendimiento en monedas sin regular, pero multas aleatorias e inspecciones eléctricas apagan tus rigs.',
};

const events: Dict = {
  'Difficulty Spike': 'Pico de dificultad',
  'A whale joined the network: difficulty +40% ($BYT only +15%).': 'Una ballena entró en la red: dificultad +40% ($BYT solo +15%).',
  'Zonal Blackout': 'Apagón zonal',
  'The grid failed in one of your rooms. Rigs are offline.': 'La red eléctrica falló en una de tus salas. Los rigs están apagados.',
  'Summer Heatwave': 'Ola de calor',
  'Ambient temperature +12°C in every room.': 'Temperatura ambiente +12°C en todas las salas.',
  'Cold Snap': 'Ola de frío',
  'Ambient temperature -8°C. Free cooling!': 'Temperatura ambiente -8°C. Refrigeración gratis!',
  'Bull Run': 'Mercado alcista',
  '$CC and $NOVA hype: prices drift towards 1.6x ($BYT only 1.15x).': 'Euforia por el $CC y el $NOVA: los precios tienden a 1.6x ($BYT solo 1.15x).',
  'Meme Mania': 'Fiebre meme',
  '$MEME volatility goes parabolic.': 'La volatilidad del $MEME se vuelve parabólica.',
};

const achievements: Dict = {
  'Hello Blockchain': 'Hola, Blockchain',
  'Reach 50 MH/s.': 'Alcanza 50 MH/s.',
  'Giga Farmer': 'Giga Granjero',
  'Reach 1 GH/s.': 'Alcanza 1 GH/s.',
  'Tera Tycoon': 'Tera Magnate',
  'Reach 1 TH/s.': 'Alcanza 1 TH/s.',
  'Peta Overlord': 'Peta Señor Supremo',
  'Reach 1 PH/s.': 'Alcanza 1 PH/s.',
  'Pocket Money': 'Dinero de bolsillo',
  'Earn $1K lifetime.': 'Gana $1K en total.',
  'Millionaire Miner': 'Minero millonario',
  'Earn $1M lifetime.': 'Gana $1M en total.',
  'Billion Byte Baron': 'Barón del Billón de Bytes',
  'Earn $1B lifetime.': 'Gana $1B en total.',
  'Rig Builder': 'Constructor de rigs',
  'Own 10 mining devices.': 'Posee 10 dispositivos de minería.',
  'Pull a Silicon God GPU.': 'Saca una GPU Dios del Silicio.',
  'Real Estate Mogul': 'Magnate inmobiliario',
  'Own 3 rooms.': 'Posee 3 salas.',
  'The First Halving': 'El primer Halving',
  'Perform The Halving.': 'Realiza el Halving.',
  'Block Hunter': 'Cazador de bloques',
  'Find a solo block.': 'Encuentra un bloque en solitario.',
  'Lucky Streak': 'Racha de suerte',
  'Find 10 solo blocks.': 'Encuentra 10 bloques en solitario.',
  Wanted: 'Se busca',
  'Survive a darknet raid.': 'Sobrevive a una redada en la darknet.',
  'Blue Screen Veteran': 'Veterano de la pantalla azul',
  'Crash a rig with a bad overclock.': 'Cuelga un rig con un mal Overclock.',
  'Overclock Artisan': 'Artesano del Overclock',
  'Apply 5 stable overclocks.': 'Aplica 5 Overclocks estables.',
  'Crew Chief': 'Jefe de cuadrilla',
  'Hire 3 technicians.': 'Contrata 3 técnicos.',
  'Diamond Hands': 'Manos de diamante',
  'Profit $1K in a single trade.': 'Obtén $1K de beneficio en una sola operación.',
  'Reliable Contractor': 'Contratista fiable',
  'Claim 10 contracts.': 'Reclama 10 contratos.',
};

const contracts: Dict = {
  Easy: 'Fácil',
  Medium: 'Media',
  Hard: 'Difícil',
  'Hash Delivery': 'Entrega de hash',
  'Cash Out': 'Cobrar beneficios',
  'Expansion Order': 'Orden de expansión',
  'Cold Chain': 'Cadena de frío',
  'Fleet Upgrade': 'Mejora de flota',
  'Block Bounty': 'Recompensa de bloque',
  'Storm Watch': 'Alerta de tormenta',
  'Algo Desk': 'Mesa algorítmica',
};

const talents: Dict = {
  'Hash Amplifier': 'Amplificador de hash',
  'Global hashrate bonus on every device.': 'Bonificación global de hashrate en todos los dispositivos.',
  'Green PPA': 'PPA verde',
  'Long-term renewable power purchase agreement.': 'Contrato de compra de energía renovable a largo plazo.',
  'Thermal Mastery': 'Maestría térmica',
  'Undervolt-friendly firmware: devices emit less heat.': 'Firmware apto para undervolt: los dispositivos emiten menos calor.',
  'Seed Capital': 'Capital semilla',
  'Start every run with extra cash.': 'Empieza cada partida con efectivo extra.',
  'Night Shift': 'Turno de noche',
  'Extends the offline earnings window.': 'Amplía la ventana de ganancias sin conexión.',
  'Silicon Whisperer': 'Susurrador de silicio',
  'Better odds in the silicon lottery.': 'Mejores probabilidades en la lotería de silicio.',
  'Insider Ticker': 'Ticker de información privilegiada',
  'Sell coins at a premium.': 'Vende monedas con prima.',
  'Tech Union': 'Sindicato técnico',
  'Free starting technician and faster maintenance.': 'Técnico inicial gratis y mantenimiento más rápido.',
  'VIP Floor Plans': 'Planos VIP',
  'Extra rack pad in every room.': 'Una base de rack extra en cada sala.',
  'Quantum Entangle': 'Entrelazamiento cuántico',
  'Late-game multiplicative hashrate bonus.': 'Bonificación multiplicativa de hashrate para el final del juego.',
  'Real Estate Trust': 'Fideicomiso inmobiliario',
  'Keep purchased rooms through every Halving.': 'Conserva las salas compradas tras cada Halving.',
};

/**
 * `TalentNode.format(level)` builds strings like "+30% hashrate" at runtime, so every level's output is
 * enumerated here (one rewrite rule per talent) instead of being a literal key.
 */
const TALENT_FORMAT_ES: Record<string, ReadonlyArray<readonly [RegExp, string]>> = {
  hash_core: [[/ hashrate$/, ' de hashrate']],
  power_discount: [[/ electricity$/, ' de electricidad']],
  thermal_mastery: [[/ heat$/, ' de calor']],
  quick_start: [[/ start$/, ' de inicio']],
  offline_ext: [[/h offline cap$/, 'h de límite offline']],
  silicon_luck: [[/ Gold\/God odds$/, ' prob. Gold/God']],
  market_insight: [[/ sell price$/, ' precio de venta']],
  tech_union: [[/ tech, /, ' téc., '], [/ speed$/, ' velocidad']],
  vip_slots: [[/ rack pads$/, ' bases de rack']],
  quantum_entanglement: [[/ hashrate$/, ' de hashrate']],
  drone_uplink: [[/ drone loot$/, ' botín de drones']],
  lab_grant: [[/ research time$/, ' tiempo de investigación']],
  room_keeper: [[/^Rooms kept$/, 'Salas conservadas'], [/^Rooms reset$/, 'Salas reiniciadas']],
  used_market: [[/^Used GPUs on sale$/, 'GPUs usadas a la venta'], [/^No used market$/, 'Sin mercado de usados']],
  forge_mastery: [[/ chance of a 2-card fusion$/, ' de prob. de fusión con 2 tarjetas']],
  solo_luck: [[/ solo block payout$/, ' pago por bloque en solitario']],
};

function talentFormats(): Dict {
  const out: Record<string, string> = {};
  for (const node of PRESTIGE_TREE) {
    const rules = TALENT_FORMAT_ES[node.id] ?? [];
    for (let level = 0; level <= node.maxLevel; level += 1) {
      const en = node.format(level);
      out[en] = rules.reduce((text, [re, rep]) => text.replace(re, rep), en);
    }
  }
  return out;
}

export const esData: Dict = {
  ...hardware,
  ...rooms,
  ...pools,
  ...events,
  ...achievements,
  ...contracts,
  ...talents,
  ...talentFormats(),
};
