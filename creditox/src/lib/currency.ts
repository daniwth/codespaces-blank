import { USD_PER_CRD } from './constants';

/**
 * Banker's rounding (round half to even).
 * @param num The number to round.
 * @param decimalPlaces The number of decimal places.
 * @returns The rounded number.
 */
function roundHalfToEven(num: number, decimalPlaces: number = 2): number {
  const d = Math.pow(10, decimalPlaces);
  const n = num * d;
  const i = Math.floor(n);
  const f = n - i;
  if (f === 0.5) {
    return (i % 2 === 0 ? i : i + 1) / d;
  }
  return Math.round(n) / d;
}

/**
 * Converts an integer amount in centiCRD to a decimal CRD amount.
 * @param centiCrd The amount in centiCRD (integer).
 * @returns The amount in CRD (decimal).
 */
export function fromCentiCrd(centiCrd: number | bigint): number {
  return Number(centiCrd) / 100;
}

/**
 * Converts a decimal CRD amount to an integer amount in centiCRD.
 * @param crd The amount in CRD (decimal).
 * @returns The amount in centiCRD (integer).
 */
export function toCentiCrd(crd: number): number {
  return Math.round(crd * 100);
}

/**
 * Converts an integer amount in USD cents to a decimal USD amount.
 * @param cents The amount in USD cents (integer).
 * @returns The amount in USD (decimal).
 */
export function fromUsdCents(cents: number | bigint): number {
  return Number(cents) / 100;
}

/**
 * Converts a decimal USD amount to an integer amount in USD cents.
 * @param usd The amount in USD (decimal).
 * @returns The amount in USD cents (integer).
 */
export function toUsdCents(usd: number): number {
  return Math.round(usd * 100);
}

/**
 * Converts an amount from CRD to USD.
 * @param crd The amount in CRD (decimal, not centiCRD).
 * @returns The equivalent amount in USD, rounded to 2 decimal places.
 */
export function crdToUsd(crd: number): number {
  const result = crd * USD_PER_CRD;
  return roundHalfToEven(result, 2);
}

/**
 * Converts an amount from USD to CRD.
 * @param usd The amount in USD.
 * @returns The equivalent amount in CRD, rounded to 2 decimal places.
 */
export function usdToCrd(usd: number): number {
  const result = usd / USD_PER_CRD;
  return roundHalfToEven(result, 2);
}

/**
 * Formats a currency amount for display.
 * @param amount The amount (decimal, not cents).
 * @param currency The currency code (e.g., 'CRD', 'USD').
 * @param locale The locale for formatting (e.g., 'en-US', 'es-ES').
 * @returns The formatted currency string.
 */
export function formatCurrency(amount: number, currency: string, locale: string = 'es-ES'): string {
  // The 'currency' option requires a valid ISO 4217 currency code.
  // 'CRD' is fictional, so we handle it specially for display purposes.
  if (currency === 'CRD') {
    return new Intl.NumberFormat(locale, {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount) + ' CRD';
  }

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency, // Assumes 'USD' or other standard codes
    currencyDisplay: 'symbol',
  }).format(amount);
}
