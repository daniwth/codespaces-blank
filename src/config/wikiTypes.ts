import type { RoomId, TalentIcon } from '../types/player';

/**
 * Data model of the in-game wiki (pure data: no React). Text supports one
 * inline markup, `**bold**`; everything else is plain text so it can be searched.
 */

/** Procedural sprite (or swatch) shown in the first column of a table row. */
export type WikiIcon =
  | { kind: 'gpu'; id: string }
  | { kind: 'psu'; id: string }
  | { kind: 'cooler'; id: string }
  | { kind: 'rack'; id: string }
  | { kind: 'room'; id: RoomId }
  | { kind: 'talent'; icon: TalentIcon }
  | { kind: 'swatch'; color: string };

export interface WikiColumn {
  label: string;
  align?: 'left' | 'right';
}

export interface WikiRow {
  /** Stable key: the catalog id the row was generated from. */
  id: string;
  /** One cell per column, already formatted. */
  cells: string[];
  icon?: WikiIcon;
  /** Accent color for the first cell (quality, pool, event…). */
  color?: string;
}

export interface WikiTable {
  id: string;
  caption?: string;
  columns: WikiColumn[];
  rows: WikiRow[];
  /** Small print under the table. */
  note?: string;
}

export type WikiTone = 'tip' | 'warn' | 'info';

export type WikiBlock =
  | { type: 'p'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'steps'; items: string[] }
  | { type: 'callout'; tone: WikiTone; text: string }
  | { type: 'formula'; text: string }
  | { type: 'table'; table: WikiTable };

export interface WikiEntry {
  id: string;
  title: string;
  blocks: WikiBlock[];
  /** Extra search terms that do not appear in the text (synonyms, English names). */
  keywords?: string[];
}

export type WikiSectionIcon =
  | 'start' | 'hardware' | 'thermal' | 'bios' | 'rooms' | 'crew' | 'pools'
  | 'market' | 'contracts' | 'halving' | 'vip' | 'lab' | 'trophies' | 'save' | 'tips';

export interface WikiSection {
  id: string;
  title: string;
  icon: WikiSectionIcon;
  color: string;
  /** One-line description shown under the section title. */
  summary: string;
  entries: WikiEntry[];
}
