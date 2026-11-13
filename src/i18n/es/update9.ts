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
};
