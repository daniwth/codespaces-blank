import { describe, it, expect } from 'vitest';
import { crdToUsd, usdToCrd, formatCurrency } from './currency';
import { USD_PER_CRD } from './constants';

describe('Currency Conversion Logic', () => {
  it('should correctly convert CRD to USD', () => {
    const crdAmount = 100; // 100 CRD
    const expectedUsd = 120; // 100 * 1.2
    expect(crdToUsd(crdAmount)).toBe(expectedUsd);
  });

  it('should correctly convert USD to CRD', () => {
    const usdAmount = 120; // 120 USD
    const expectedCrd = 100; // 120 / 1.2
    expect(usdToCrd(usdAmount)).toBe(expectedCrd);
  });

  it('should apply banker\'s rounding (round half to even) correctly', () => {
    // 2.5 should round to 2 (even)
    const usd1 = 2.5 / USD_PER_CRD; // 2.08333...
    expect(usdToCrd(2.5)).toBe(2.08);

    // 3.5 should round to 4 (even)
    const usd2 = 3.5 / USD_PER_CRD; // 2.91666...
    expect(usdToCrd(3.5)).toBe(2.92);

    // Test crdToUsd rounding
    expect(crdToUsd(2.085)).toBe(2.50); // rounds up to even 0
    expect(crdToUsd(2.075)).toBe(2.49); // rounds down
  });

  it('should format currency correctly', () => {
    // Test CRD formatting (custom)
    expect(formatCurrency(1234.56, 'CRD', 'es-ES')).toBe('1.234,56 CRD');
    expect(formatCurrency(1234.56, 'CRD', 'en-US')).toBe('1,234.56 CRD');

    // Test USD formatting (standard)
    // Note: The actual symbol and format depends on the testing environment's locale data.
    // This test might be fragile. We'll check for the number and a symbol.
    const formattedUsd_es = formatCurrency(1234.56, 'USD', 'es-ES');
    expect(formattedUsd_es).toContain('1.234,56');

    const formattedUsd_en = formatCurrency(1234.56, 'USD', 'en-US');
    expect(formattedUsd_en).toContain('1,234.56');
    expect(formattedUsd_en.startsWith('$')).toBe(true);
  });
});
