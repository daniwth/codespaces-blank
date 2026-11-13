import type { Dict } from '..';

/** Strings added by the v9 update (game feel, depth, economy and quality of life). */
export const esUpdate9: Dict = {
  // Rack labels on the canvas: short enough for a 40 px rack (the font strips the accents)
  'NO PSU (rack)': 'SIN PSU',
  'OVERLOAD (rack)': 'SOBRECARGA',
  'HOT! (rack)': '¡CALOR!',
  'REBOOT (rack)': 'REINICIO',
  'NO POWER (rack)': 'SIN LUZ',
  'EMPTY (rack)': 'VACÍO',
  'NO PSU': 'SIN PSU',

  // Shop: net ROI
  'Net ROI: price / (mined value - power bill) for this room, your PSUs, pool and the current coin price.': 'ROI neto: precio / (valor minado - factura eléctrica) para esta sala, tus PSU, el pool y el precio actual de la moneda.',
  '{power} · {eff}': '{power} · {eff}',
  'net ROI {x}': 'ROI neto {x}',
  'net ROI: never (loses money here)': 'ROI neto: nunca (aquí pierde dinero)',
  'Estimated power bill of this card in the room on screen, with its grid tariff and the efficiency of your PSUs.': 'Factura eléctrica estimada de esta tarjeta en la sala en pantalla, con su tarifa de red y la eficiencia de tus PSU.',
  'net {x}/s': 'neto {x}/s',

  // Phase 2: canvas juice, thermal view, crew rally, special drones, ambience
  'SHARE': 'SHARE',
  'LN2 {delta}C {s}S': 'LN2 {delta}C {s}S',
  'THERMAL VIEW': 'VISTA TÉRMICA',
  'AIR {temp}C': 'AIRE {temp}C',
  'Thermal view: color every rack by its real temperature (T)': 'Vista térmica: colorea cada rack según su temperatura real (T)',
  'Thermal': 'Térmica',
  'Thermal view': 'Vista térmica',
  'Catch the nitrogen drone': 'Atrapa el dron de nitrógeno',
  'Catch the VIP drone': 'Atrapa el dron VIP',
  'Catch the audit drone': 'Atrapa el dron de auditoría',
  'NITRO!': '¡NITRO!',
  'VIP!': '¡VIP!',
  'AUDIT!': '¡AUDITORÍA!',
  'Click a technician (or this button) to rally the crew: maintenance x{mul} and +{pct}% cooling for {sec}s.': 'Haz clic en un técnico (o en este botón) para arengar al equipo: mantenimiento x{mul} y +{pct}% de refrigeración durante {sec} s.',
  'Rally {time}': 'Arenga {time}',
  'Crew rests {time}': 'Descanso {time}',
  'Rally the crew': 'Arengar al equipo',
  'Effects volume': 'Volumen de efectos',
  'Ambience volume': 'Volumen de ambiente',
  'Fan and room hum: it follows the hashrate and the average temperature of the farm.': 'Zumbido de ventiladores y sala: sigue el hashrate y la temperatura media de la granja.',
  'Audit bonus: +{cash} on that contract.': 'Bonus de auditoría: +{cash} en ese contrato.',
  'A LIQUID NITROGEN DRONE is crossing the room: catch it to chill every room!': 'Un DRON DE NITRÓGENO LÍQUIDO cruza la sala: ¡atrápalo para enfriar todas las salas!',
  'A VIP DRONE is crossing the room: catch it before it leaves!': 'Un DRON VIP cruza la sala: ¡atrápalo antes de que se vaya!',
  'An AUDIT DRONE is crossing the room: catch it for a contract bonus!': 'Un DRON DE AUDITORÍA cruza la sala: ¡atrápalo para un bonus de contrato!',
  'LIQUID NITROGEN DRONE: ambient {delta}°C in every room for {sec}s.': 'DRON DE NITRÓGENO LÍQUIDO: ambiente {delta}°C en todas las salas durante {sec} s.',
  'VIP DRONE: every block pays x{mul} for {min} min.': 'DRON VIP: cada bloque paga x{mul} durante {min} min.',
  'VIP DRONE: {n} gems!': 'DRON VIP: ¡{n} gemas!',
  'AUDIT DRONE: clean books. Your next contract claim pays +{pct}% cash.': 'DRON DE AUDITORÍA: cuentas limpias. Tu próximo contrato reclamado paga +{pct}% de efectivo.',
  'CREW RALLY! Maintenance x{mul} and +{pct}% cooling for {sec}s.': '¡ARENGA AL EQUIPO! Mantenimiento x{mul} y +{pct}% de refrigeración durante {sec} s.',
};
