import { tr, type Lang, type Params } from '../i18n';

/**
 * A log parameter: a number, a string (translated when shown if the dictionary knows it:
 * item names, room names…) or a nested translatable template with its own params.
 */
export type LogParam = string | number | { key: string; params?: Params };
export type LogParams = Record<string, LogParam>;

export interface LogText {
  text: string;
  key?: string;
  params?: LogParams;
}

/** English text of a template (what `text` holds for consumers that do not translate). */
export function fillLog(key: string, params?: LogParams): string {
  return logLine({ text: key, key, params }, 'en');
}

/**
 * Text of a log line in `lang`. Lines logged with a template are rendered on the fly, so the
 * whole log follows a language switch; plain-text lines keep the language they were written in.
 */
export function logLine(entry: LogText, lang?: Lang): string {
  if (!entry.key) return entry.text;
  const out: Params = {};
  Object.entries(entry.params ?? {}).forEach(([k, v]) => {
    out[k] = typeof v === 'number' ? v : typeof v === 'string' ? tr(v, undefined, lang) : tr(v.key, v.params, lang);
  });
  return tr(entry.key, out, lang);
}
