import { create } from 'zustand';

export type Lang = 'en' | 'es';
export const LANGS: readonly { id: Lang; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'es', label: 'Español' },
];

const STORAGE_KEY = 'hh-lang';

function detect(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'es') return saved;
  } catch {
    /* storage blocked */
  }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('es') ? 'es' : 'en';
}

interface LangState {
  lang: Lang;
  setLang: (lang: Lang) => void;
}

/** UI language. Independent from the game save (not part of GameData), stored in localStorage. */
export const useLangStore = create<LangState>((set) => ({
  lang: detect(),
  setLang: (lang) => {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* ignore */
    }
    if (typeof document !== 'undefined') document.documentElement.lang = lang;
    set({ lang });
  },
}));

export type Params = Record<string, string | number>;
export type Dict = Readonly<Record<string, string>>;

let es: Dict | null = null;
/** Registered by `./es` (imported once from main.tsx / tests via `registerEs`). */
export function registerEs(dict: Dict): void {
  es = dict;
}

function fill(text: string, params?: Params): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

/**
 * Translate an English source string. English text IS the key: `tr('Buy')`.
 * Placeholders use `{name}`: `tr('Rack {n} is full', { n: 3 })`.
 * Missing translations fall back to the English text. Not reactive — inside React use `useT()`.
 */
export function tr(en: string, params?: Params, lang: Lang = useLangStore.getState().lang): string {
  const text = lang === 'es' ? es?.[en] ?? en : en;
  return fill(text, params);
}

/** Reactive translate function: the component re-renders when the language changes. */
export function useT(): (en: string, params?: Params) => string {
  const lang = useLangStore((s) => s.lang);
  return (en, params) => tr(en, params, lang);
}

export function useLang(): Lang {
  return useLangStore((s) => s.lang);
}
