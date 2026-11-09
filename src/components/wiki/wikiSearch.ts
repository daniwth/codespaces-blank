/**
 * Pure search over the wiki data (no React, testable in Node). Accent and case
 * insensitive: "energia" finds "energía", "camara" finds "Cámara".
 */
import type { WikiBlock, WikiEntry, WikiSection, WikiTable } from '../../config/wikiTypes';

/** Lowercase, strip accents and the `**bold**` markup. */
export const normalizeText = (text: string): string =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\*\*/g, '').toLowerCase();

export const queryTokens = (query: string): string[] =>
  normalizeText(query).split(/\s+/).map((t) => t.trim()).filter(Boolean);

const tableHeadText = (t: WikiTable): string => [t.caption ?? '', t.note ?? '', ...t.columns.map((c) => c.label)].join(' ');

const rowText = (cells: string[], id: string): string => `${cells.join(' ')} ${id}`;

export function blockText(block: WikiBlock): string {
  switch (block.type) {
    case 'p':
    case 'callout':
    case 'formula':
      return block.text;
    case 'list':
    case 'steps':
      return block.items.join(' ');
    case 'table':
      return [tableHeadText(block.table), ...block.table.rows.map((r) => rowText(r.cells, r.id))].join(' ');
    default:
      return '';
  }
}

const hasAll = (haystack: string, tokens: string[]) => tokens.every((t) => haystack.includes(t));
const hasAny = (haystack: string, tokens: string[]) => tokens.some((t) => haystack.includes(t));

/**
 * Narrow one entry to the blocks that mention the query. Returns null when the
 * entry does not contain every token. A match on the entry/section title or its
 * keywords keeps the whole entry; otherwise only the matching paragraphs and
 * table rows stay (a table whose caption or headers match stays whole).
 */
export function filterEntry(entry: WikiEntry, sectionTitle: string, tokens: string[]): WikiEntry | null {
  if (!tokens.length) return entry;
  const head = normalizeText([sectionTitle, entry.title, ...(entry.keywords ?? [])].join(' '));
  const body = entry.blocks.map((b) => normalizeText(blockText(b)));
  if (!hasAll(`${head} ${body.join(' ')}`, tokens)) return null;
  if (hasAll(head, tokens)) return entry;

  const blocks: WikiBlock[] = [];
  entry.blocks.forEach((b, i) => {
    if (!hasAny(body[i], tokens)) return;
    if (b.type !== 'table' || hasAny(normalizeText(tableHeadText(b.table)), tokens)) {
      blocks.push(b);
      return;
    }
    const rows = b.table.rows.filter((r) => hasAny(normalizeText(rowText(r.cells, r.id)), tokens));
    if (rows.length) blocks.push({ type: 'table', table: { ...b.table, rows } });
  });
  return { ...entry, blocks: blocks.length ? blocks : entry.blocks };
}

export interface WikiSearchResult {
  sections: WikiSection[];
  /** Matching entries across all sections. */
  entryCount: number;
}

/** Filter sections and entries by a free-text query (all words must appear in an entry). */
export function searchWiki(sections: WikiSection[], query: string): WikiSearchResult {
  const tokens = queryTokens(query);
  if (!tokens.length) return { sections, entryCount: sections.reduce((a, s) => a + s.entries.length, 0) };
  const out: WikiSection[] = [];
  let entryCount = 0;
  sections.forEach((s) => {
    const entries = s.entries.map((e) => filterEntry(e, `${s.title} ${s.summary}`, tokens)).filter((e): e is WikiEntry => e !== null);
    if (!entries.length) return;
    entryCount += entries.length;
    out.push({ ...s, entries });
  });
  return { sections: out, entryCount };
}

const ACCENT_CLASSES: Record<string, string> = {
  a: '[aáàäâ]', e: '[eéèëê]', i: '[iíìïî]', o: '[oóòöô]', u: '[uúùüû]', n: '[nñ]', c: '[cç]',
};

/** Regex matching any query token in the original (accented) text, for highlighting. */
export function highlightRegex(query: string): RegExp | null {
  const tokens = queryTokens(query).filter((t) => t.length >= 2);
  if (!tokens.length) return null;
  const parts = tokens
    .sort((a, b) => b.length - a.length)
    .map((t) => Array.from(t, (ch) => ACCENT_CLASSES[ch] ?? ch.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&')).join(''));
  return new RegExp(`(${parts.join('|')})`, 'gi');
}
