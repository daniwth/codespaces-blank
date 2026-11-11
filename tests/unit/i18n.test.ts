import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tr, useLangStore } from '../../src/i18n';
import { ES } from '../../src/i18n/es';

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(p) ? [p] : [];
  });

/** Every literal `t('…')` / `tr('…')` / `logT('…')` in the source must have a Spanish entry. */
describe('i18n coverage', () => {
  const missing: string[] = [];
  const re = /\b(?:t|tr|logT)\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`([^`$]*)`)/g;
  for (const file of walk('src').filter((f) => !f.includes('/i18n/'))) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(re)) {
      const key = (m[1] ?? m[2] ?? m[3] ?? '').replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\n/g, '\n');
      if (key && !(key in ES)) missing.push(`${file}: ${key}`);
    }
  }
  it('has no untranslated literal keys', () => {
    expect(missing).toEqual([]);
  });

  it('keeps placeholders identical in both languages', () => {
    const bad = Object.entries(ES).filter(([en, es]) => {
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
      return ph(en) !== ph(es);
    });
    expect(bad.map(([k]) => k)).toEqual([]);
  });

  it('switches language and fills params, falling back to English', () => {
    useLangStore.getState().setLang('en');
    expect(tr('Hello {n}', { n: 2 })).toBe('Hello 2');
    useLangStore.getState().setLang('es');
    expect(tr('Not translated {n}', { n: 2 })).toBe('Not translated 2');
    useLangStore.getState().setLang('en');
  });
});
