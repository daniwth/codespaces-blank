import type { Dict } from '..';

/** Messages produced by the store, the physics (via gameMsg keys) and the formatters. */
export const esStore: Dict = {
  // hardwareSlice
  'Not enough cash for {label} ({price}).': 'No tienes suficiente efectivo para {label} ({price}).',
  'thermal paste': 'pasta térmica',
  'silicon repair': 'reparación de silicio',
  'Bought {brand} {name} — Silicon Lottery: {quality}!': 'Compraste {brand} {name} — Lotería de silicio: {quality}!',
  'Bought PSU {name}.': 'Compraste la fuente {name}.',
  'Bought cooler {name}.': 'Compraste el enfriador {name}.',
  'Bought {name}. Click an empty floor pad to place it.': 'Compraste {name}. Haz clic en una base libre del suelo para colocarlo.',
  'Gold Edition racks are soulbound and cannot be sold.': 'Los racks Gold Edition están ligados a tu cuenta y no se pueden vender.',
  'Empty the rack before selling it.': 'Vacía el rack antes de venderlo.',
  'Sold for {price}.': 'Vendido por {price}.',
  'Gold Edition racks have a built-in power plant.': 'Los racks Gold Edition tienen una central eléctrica integrada.',
  'BSOD! {name} overclock unstable. Rig rebooting (10s).': 'BSOD! El Overclock de {name} es inestable. El rig se reinicia (10s).',
  'Overclock stable: {bonus}% hashrate on {name}.': 'Overclock estable: {bonus}% de hashrate en {name}.',
  'AI Diagnostics tuned {name}: +{bonus}% safe.': 'AI Diagnostics ajustó {name}: +{bonus}% seguro.',
  '{name} reballed & repaired. Efficiency restored.': '{name} reparada con reballing. Eficiencia restaurada.',

  // economySlice
  'THE HALVING! Your run is cashed out — you minted {reward} Smart Contracts ($SC) and +5 gems.': 'EL HALVING! Cobraste tu partida: acuñaste {reward} Smart Contracts ($SC) y +5 gemas.',
  'Smart Contract deployed: {name} Lv.{level}.': 'Smart Contract desplegado: {name} Nv.{level}.',
  'Need {cost} gems.': 'Necesitas {cost} gemas.',
  'Gold Edition Rack delivered! Zero electricity, half the heat. Place it on a pad.': 'Rack Gold Edition entregado! Cero electricidad y la mitad de calor. Colócalo en una base.',
  'AI Diagnostics online: safe auto-overclock available in every BIOS.': 'AI Diagnostics en línea: auto-Overclock seguro disponible en cada BIOS.',
  'Peak Auto-Seller armed: all $CC sells automatically above 1.3x.': 'Auto-vendedor de picos activado: todo el $CC se vende solo por encima de 1.3x.',
  'ACHIEVEMENT: {name} (+{gems} gems)': 'LOGRO: {name} (+{gems} gemas)',

  // roomsSlice
  'Unlock {name} first.': 'Desbloquea antes {name}.',
  '{name} costs {price}.': '{name} cuesta {price}.',
  'New property: {name}! {subtitle}.': 'Nueva propiedad: {name}! {subtitle}.',
  'Hiring a technician costs {price}.': 'Contratar a un técnico cuesta {price}.',
  'A new technician joined the crew. They will re-paste and repair rigs automatically.': 'Un nuevo técnico se unió al equipo. Cambiará la pasta térmica y reparará los rigs automáticamente.',

  // marketSlice
  'No {coin} to sell.': 'No tienes {coin} para vender.',
  'Sold {qty} {coin} for {price}.': 'Vendiste {qty} {coin} por {price}.',
  'Not enough cash.': 'No tienes suficiente efectivo.',
  'Bought {qty} {coin} for {price}.': 'Compraste {qty} {coin} por {price}.',
  'Trading bots unlock at level {level}.': 'Los bots de trading se desbloquean en el nivel {level}.',
  '{name} unlocks at level {level}.': '{name} se desbloquea en el nivel {level}.',
  'Switched to {name}.': 'Cambiaste a {name}.',

  // contractsSlice
  '1 gem': '1 gema',
  '{n} gems': '{n} gemas',
  'CONTRACT COMPLETE: {title} — {goal}. Claim {reward} in the Contracts tab.': 'CONTRATO COMPLETADO: {title} — {goal}. Reclama {reward} en la pestaña Contratos.',
  'Contract expired: {title} ({goal}).': 'Contrato expirado: {title} ({goal}).',
  'New contract on the board: {title}.': 'Nuevo contrato en el tablón: {title}.',
  'Contract claimed: {title} → {reward} (in Rigs storage).': 'Contrato reclamado: {title} → {reward} (en el almacén de Rigs).',
  'Contract claimed: {title} → {reward}.': 'Contrato reclamado: {title} → {reward}.',
  'Next reroll in {time}.': 'Próximo reroll en {time}.',
  'Rerolling a contract costs {price}.': 'Hacer reroll de un contrato cuesta {price}.',
  'Contract rerolled for {price}: {title}.': 'Reroll de contrato por {price}: {title}.',

  // store/contracts.ts
  'Mine {n} $CC (sold or held)': 'Mina {n} $CC (vendidos o guardados)',
  'Realize {amount} of trading profit': 'Obtén {amount} de beneficio en trading',
  'Earn {amount} profit from trading bots': 'Gana {amount} de beneficio con bots de trading',
  'Reach {hash} of hashrate': 'Alcanza {hash} de hashrate',
  'Keep every die under {temp}°C for {time}': 'Mantén cada chip por debajo de {temp}°C durante {time}',
  'Run 1 GPU of tier {tier}+ at once': 'Ten 1 GPU de tier {tier}+ funcionando a la vez',
  'Run {n} GPUs of tier {tier}+ at once': 'Ten {n} GPU de tier {tier}+ funcionando a la vez',
  'Find 1 solo block': 'Encuentra 1 bloque en solitario',
  'Find {n} solo blocks': 'Encuentra {n} bloques en solitario',
  'Survive 1 network event with no thermal shutdown': 'Supera 1 evento de red sin apagados térmicos',
  'Survive {n} network events with no thermal shutdown': 'Supera {n} eventos de red sin apagados térmicos',
  'Only mined coins count; bought $CC does not.': 'Solo cuentan las monedas minadas; el $CC comprado no.',
  'Only profit over what you paid for the coins counts.': 'Solo cuenta el beneficio sobre lo que pagaste por las monedas.',
  'Realized profit from bot sells (Market tab).': 'Beneficio realizado en ventas de bots (pestaña Mercado).',
  'Live hashrate, measured every tick.': 'Hashrate en vivo, medido en cada tick.',
  'Streak needs {hash}+ running. Offline time resets it.': 'La racha requiere {hash}+ activos. El tiempo sin conexión la reinicia.',
  'Tier {tier}: {name} or better, mounted and hashing.': 'Tier {tier}: {name} o mejor, montada y minando.',
  'Switch to the Solo pool (Pools tab).': 'Cambia al pool Solo (pestaña Pools).',
  'From the start of an event to its end. Offline time voids it.': 'Desde el inicio de un evento hasta su final. El tiempo sin conexión lo anula.',

  // useGameStore + save codec errors
  'Save imported and verified (SHA-256 OK).': 'Partida importada y verificada (SHA-256 OK).',
  'Save imported successfully.': 'Partida importada correctamente.',
  'Factory reset complete. Welcome back to the bedroom.': 'Reinicio de fábrica completado. Bienvenido de nuevo al dormitorio.',
  'New farm founded: one PX-460 on a bench in your bedroom. Happy hashing!': 'Nueva granja fundada: una PX-460 sobre un banco en tu dormitorio. Feliz minado!',
  'Corrupted save: not valid Base64/JSON.': 'Partida dañada: no es Base64/JSON válido.',
  'Unknown save format.': 'Formato de partida desconocido.',
  'Checksum mismatch: the save was modified or damaged.': 'El checksum no coincide: la partida fue modificada o está dañada.',
  'Save comes from a newer game version.': 'La partida pertenece a una versión más reciente del juego.',

  // gamePhysics messages (gameMsg keys)
  '$MEME PUMP! Whales are buying.': '$MEME PUMP! Las ballenas están comprando.',
  '$MEME DUMP! Paper hands everywhere.': '$MEME DUMP! Manos de papel por todas partes.',
  'Network event ended: {name}.': 'Evento de red terminado: {name}.',
  'NETWORK EVENT: {name} ({room}). {description}': 'EVENTO DE RED: {name} ({room}). {description}',
  'NETWORK EVENT: {name}. {description}': 'EVENTO DE RED: {name}. {description}',
  'THERMAL SHUTDOWN: {name} hit {temp}°C!': 'APAGADO TÉRMICO: {name} llegó a {temp}°C!',
  '{name} cooled down and restarted.': '{name} se enfrió y se reinició.',
  'BLOCK FOUND! Solo jackpot of {cc} $CC + 1 gem!': 'BLOQUE ENCONTRADO! Jackpot en solitario de {cc} $CC + 1 gema!',
  'BLOCK FOUND! Solo jackpot of {cc} $CC!': 'BLOQUE ENCONTRADO! Jackpot en solitario de {cc} $CC!',
  'RAID! Electrical inspection in {room}. Fined ${fine}, rigs offline 30s.': 'REDADA! Inspección eléctrica en {room}. Multa de ${fine}, rigs apagados 30s.',
  'BOT #{id} {side} {coin} @ {price}': 'BOT #{id} {side} {coin} @ {price}',
  BUY: 'COMPRAR',
  SELL: 'VENDER',

  // formatters
  'just now': 'ahora mismo',
  '{n} min ago': 'hace {n} min',
  '{n} h ago': 'hace {n} h',
  yesterday: 'ayer',
  '{n} days ago': 'hace {n} días',

  // challengesSlice & friends
  'Challenge {name}: {reason}': 'Reto {name}: {reason}',
  'the BIOS is locked at stock clocks.': 'la BIOS está bloqueada a frecuencias de fábrica.',
  'you can only use the Bedroom.': 'solo puedes usar el Dormitorio.',
  'Challenge abandoned: {name}. The run continues unrestricted and keeps its normal Halving reward, without the challenge bonus.': 'Reto abandonado: {name}. La partida sigue sin restricciones y conserva su recompensa normal de Halving, sin el bonus del reto.',
  'Challenge started: {name}. {description}': 'Reto iniciado: {name}. {description}',
  'CHALLENGE COMPLETE: {name} in {time}! First clear bonus: +{sc} $SC and +{gems} gems. The restriction is lifted.': 'RETO SUPERADO: {name} en {time}! Bonus de primera victoria: +{sc} $SC y +{gems} gemas. La restricción se levanta.',
  'CHALLENGE COMPLETE: {name} in {time}! Repeat bonus: +{sc} $SC and +{gems} gems. The restriction is lifted.': 'RETO SUPERADO: {name} en {time}! Bonus de repetición: +{sc} $SC y +{gems} gemas. La restricción se levanta.',
};
