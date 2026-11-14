import {
  AlertTriangle,
  Atom,
  Award,
  BookOpen,
  Building2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Coins,
  Cpu,
  Crown,
  FlaskConical,
  Gauge,
  HardHat,
  Info,
  Leaf,
  Lightbulb,
  LineChart,
  Moon,
  Network,
  Radar,
  Rocket,
  Save,
  Search,
  Snowflake,
  Thermometer,
  TrendingUp,
  Wrench,
  X,
  Zap,
  type LucideIcon, Dices, Hammer, Recycle } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getWikiSections } from '../../config/wikiContent';
import type { WikiBlock, WikiEntry, WikiIcon, WikiSection, WikiSectionIcon, WikiTable, WikiTone } from '../../config/wikiTypes';
import { sprites } from '../../engine/SpriteManager';
import { useLang, useT } from '../../i18n';
import type { TalentIcon } from '../../types/player';
import { cn } from '../../utils/cn';
import { PixelButton } from '../ui/PixelButton';
import { PixelModal } from '../ui/PixelModal';
import { SpriteImg } from '../ui/SpriteImg';
import { highlightRegex, searchWiki } from './wikiSearch';

const SECTION_ICONS: Record<WikiSectionIcon, LucideIcon> = {
  start: Rocket, hardware: Cpu, thermal: Thermometer, bios: Gauge, rooms: Building2, crew: HardHat, pools: Network,
  market: LineChart, contracts: ClipboardList, halving: Coins, vip: Crown, lab: FlaskConical, trophies: Award, save: Save, tips: Lightbulb,
};

const TALENT_ICONS: Record<TalentIcon, LucideIcon> = {
  zap: Zap, leaf: Leaf, snowflake: Snowflake, coins: Coins, moon: Moon, cpu: Cpu,
  trending: TrendingUp, wrench: Wrench, crown: Crown, atom: Atom, building: Building2, radar: Radar, flask: FlaskConical, recycle: Recycle, hammer: Hammer, dice: Dices,
};

const TONES: Record<WikiTone, { icon: LucideIcon; color: string; bg: string; label: string }> = {
  tip: { icon: Lightbulb, color: '#a3e635', bg: '#132008', label: 'TIP' },
  warn: { icon: AlertTriangle, color: '#fbbf24', bg: '#241603', label: 'WARNING' },
  info: { icon: Info, color: '#22d3ee', bg: '#071c24', label: 'INFO' },
};

const anchorId = (sectionId: string, entryId?: string) => `wiki-${sectionId}${entryId ? `-${entryId}` : ''}`;

// ───────────────────────── Inline text ─────────────────────────

function highlight(text: string, re: RegExp | null, keyBase: string): ReactNode {
  if (!re) return text;
  return text.split(re).map((part, i) =>
    i % 2 === 1 ? (
      <mark key={`${keyBase}-${i}`} className="bg-amber/35 px-px text-ink">
        {part}
      </mark>
    ) : (
      <Fragment key={`${keyBase}-${i}`}>{part}</Fragment>
    ),
  );
}

/** Renders `**bold**` markup with optional search highlighting. */
function Inline({ text, hl }: { text: string; hl: RegExp | null }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
          <b key={i} className="font-normal text-gold">
            {highlight(part.slice(2, -2), hl, `b${i}`)}
          </b>
        ) : (
          <Fragment key={i}>{highlight(part, hl, `t${i}`)}</Fragment>
        ),
      )}
    </>
  );
}

// ───────────────────────── Tables ─────────────────────────

function RowIcon({ icon }: { icon: WikiIcon }) {
  switch (icon.kind) {
    case 'gpu':
      return <SpriteImg src={sprites.gpuIcon(icon.id)} width={48} alt="" className="shrink-0" />;
    case 'psu':
      return <SpriteImg src={sprites.psuIcon(icon.id)} width={42} height={15} alt="" className="shrink-0" />;
    case 'cooler':
      return <SpriteImg src={sprites.coolerIcon(icon.id)} width={24} height={24} alt="" className="shrink-0" />;
    case 'rack':
      return <SpriteImg src={sprites.rackIcon(icon.id)} width={15} height={24} alt="" className="shrink-0" />;
    case 'room':
      return <SpriteImg src={sprites.roomIcon(icon.id)} width={48} height={27} alt="" className="shrink-0" />;
    case 'talent': {
      const Icon = TALENT_ICONS[icon.icon];
      return <Icon size={16} className="shrink-0 text-gold" aria-hidden />;
    }
    case 'swatch':
      return <span className="inline-block size-2.5 shrink-0" style={{ background: icon.color, boxShadow: `0 0 4px ${icon.color}` }} aria-hidden />;
    default:
      return null;
  }
}

/** A table cell: the first line is the value, extra lines (`\n`) are small print. */
function Cell({ text, hl }: { text: string; hl: RegExp | null }) {
  const [head, ...rest] = text.split('\n');
  return (
    <>
      <Inline text={head} hl={hl} />
      {rest.map((line, i) => (
        <span key={i} className="block whitespace-nowrap text-[13px] text-dim">
          <Inline text={line} hl={hl} />
        </span>
      ))}
    </>
  );
}

function TableView({ table, hl }: { table: WikiTable; hl: RegExp | null }) {
  return (
    <figure className="flex min-w-0 flex-col gap-1" data-wiki-table={table.id}>
      {table.caption && (
        <figcaption className="font-silk text-[10px] uppercase tracking-wide text-neon">
          <Inline text={table.caption} hl={hl} />
        </figcaption>
      )}
      <div className="retro-scroll max-w-full overflow-x-auto shadow-[inset_0_0_0_2px_#241f45]">
        <table className="w-full border-collapse text-[15px] leading-tight">
          <thead>
            <tr className="bg-panel-3">
              {table.columns.map((c, i) => (
                <th
                  key={c.label}
                  scope="col"
                  className={cn('whitespace-nowrap px-2 py-1 font-silk text-[9px] font-normal uppercase text-dim', c.align === 'right' && i > 0 ? 'text-right' : 'text-left')}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r, ri) => (
              <tr key={r.id} className={ri % 2 ? 'bg-panel-2/60' : 'bg-panel'} data-row={r.id}>
                {r.cells.map((cell, ci) => (
                  <td
                    key={ci}
                    className={cn(
                      'px-2 py-1 align-middle',
                      ci === 0 ? 'min-w-[9rem] text-ink' : 'text-ink/85',
                      table.columns[ci]?.align === 'right' && ci > 0 && 'whitespace-nowrap text-right',
                    )}
                    style={ci === 0 && r.color ? { color: r.color } : undefined}
                  >
                    {ci === 0 ? (
                      <span className="flex items-center gap-2">
                        {r.icon && <RowIcon icon={r.icon} />}
                        <span>
                          <Cell text={cell} hl={hl} />
                        </span>
                      </span>
                    ) : (
                      <Cell text={cell} hl={hl} />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.note && (
        <p className="text-[14px] leading-tight text-dim">
          <Inline text={table.note} hl={hl} />
        </p>
      )}
    </figure>
  );
}

// ───────────────────────── Blocks & entries ─────────────────────────

function Block({ block, hl }: { block: WikiBlock; hl: RegExp | null }) {
  const t = useT();
  switch (block.type) {
    case 'p':
      return (
        <p className="leading-snug text-ink/90">
          <Inline text={block.text} hl={hl} />
        </p>
      );
    case 'list':
      return (
        <ul className="flex flex-col gap-1 leading-snug text-ink/90">
          {block.items.map((item, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-neon" aria-hidden>▸</span>
              <span className="min-w-0">
                <Inline text={item} hl={hl} />
              </span>
            </li>
          ))}
        </ul>
      );
    case 'steps':
      return (
        <ol className="flex flex-col gap-1.5 leading-snug text-ink/90">
          {block.items.map((item, i) => (
            <li key={i} className="flex gap-2">
              <span className="grid size-5 shrink-0 place-items-center bg-lime font-pixel text-[8px] text-void" aria-hidden>
                {i + 1}
              </span>
              <span className="min-w-0">
                <Inline text={item} hl={hl} />
              </span>
            </li>
          ))}
        </ol>
      );
    case 'callout': {
      const tone = TONES[block.tone];
      const Icon = tone.icon;
      return (
        <div className="flex gap-2 p-2 leading-snug" style={{ background: tone.bg, boxShadow: `inset 3px 0 0 0 ${tone.color}` }}>
          <Icon size={16} className="mt-0.5 shrink-0" style={{ color: tone.color }} aria-hidden />
          <p className="min-w-0 text-ink/90">
            <span className="mr-1.5 font-pixel text-[8px]" style={{ color: tone.color }}>
              {t(tone.label)}
            </span>
            <Inline text={block.text} hl={hl} />
          </p>
        </div>
      );
    }
    case 'formula':
      return (
        <div className="crt max-w-full px-3 py-1.5 text-[17px] leading-tight text-lime">
          <code className="relative z-[1] whitespace-pre-wrap break-words font-term">
            <Inline text={block.text} hl={hl} />
          </code>
        </div>
      );
    case 'table':
      return <TableView table={block.table} hl={hl} />;
    default:
      return null;
  }
}

function EntryView({ section, entry, hl }: { section: WikiSection; entry: WikiEntry; hl: RegExp | null }) {
  return (
    <section id={anchorId(section.id, entry.id)} className="flex scroll-mt-2 flex-col gap-2" data-wiki-entry={entry.id}>
      <h4 className="flex items-center gap-2 font-pixel text-[10px] leading-relaxed text-ink">
        <span className="inline-block h-3 w-1.5 shrink-0" style={{ background: section.color }} aria-hidden />
        <Inline text={entry.title} hl={hl} />
      </h4>
      {entry.blocks.map((b, i) => (
        <Block key={i} block={b} hl={hl} />
      ))}
    </section>
  );
}

function SectionHeader({ section, hl }: { section: WikiSection; hl: RegExp | null }) {
  const Icon = SECTION_ICONS[section.icon];
  return (
    <header className="flex items-start gap-3 p-2" style={{ background: `linear-gradient(90deg, ${section.color}22, transparent)`, boxShadow: `inset 0 -2px 0 0 ${section.color}55` }}>
      <Icon size={22} className="mt-0.5 shrink-0" style={{ color: section.color }} aria-hidden />
      <div className="min-w-0">
        <h3 className="font-pixel text-[12px] leading-relaxed" style={{ color: section.color }}>
          <Inline text={section.title} hl={hl} />
        </h3>
        <p className="text-[16px] leading-tight text-dim">{section.summary}</p>
      </div>
    </header>
  );
}

// ───────────────────────── Wiki ─────────────────────────

/** In-game wiki / how-to-play guide. All tables are generated from the balance config. */
export default function Wiki({ onClose }: { onClose: () => void }) {
  const t = useT();
  const lang = useLang();
  // Pages (and the search index built from them) are per language and rebuilt when it changes.
  const WIKI_SECTIONS = useMemo(() => getWikiSections(lang), [lang]);
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState(WIKI_SECTIONS[0].id);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const searching = query.trim().length > 0;
  const result = useMemo(() => searchWiki(WIKI_SECTIONS, query), [WIKI_SECTIONS, query]);
  const hl = useMemo(() => highlightRegex(query), [query]);
  const active = WIKI_SECTIONS.find((s) => s.id === activeId) ?? WIKI_SECTIONS[0];
  const activeIndex = WIKI_SECTIONS.indexOf(active);
  const shown: WikiSection[] = searching ? result.sections : [active];
  const navSections = searching ? result.sections : WIKI_SECTIONS;

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [activeId, searching]);

  const scrollTo = (id: string) => {
    const el = contentRef.current?.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    el?.scrollIntoView({ block: 'start' });
  };

  const openSection = (id: string) => {
    if (searching) scrollTo(anchorId(id));
    else setActiveId(id);
  };

  const countFor = (s: WikiSection) => (searching ? s.entries.length : null);

  return (
    <PixelModal
      title={
        <span className="flex items-center gap-2">
          <BookOpen size={14} /> {t("WIKI · MINER'S MANUAL")}
        </span>
      }
      onClose={onClose}
      accent="#a3e635"
      className="h-[92vh] max-w-6xl"
    >
      <div className="flex h-full min-h-0 flex-col gap-3" data-testid="wiki">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="relative flex min-w-0 flex-1 items-center">
            <Search size={14} className="pointer-events-none absolute left-2 text-dim" aria-hidden />
            <input
              ref={searchRef}
              type="text"
              role="searchbox"
              className="retro-input w-full !pl-7"
              placeholder={t('Search: throttling, Halving, PSU, gems…')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // First Escape clears the search, the next one closes the wiki.
                if (e.key === 'Escape' && query) {
                  e.stopPropagation();
                  setQuery('');
                }
              }}
              aria-label={t('Search the wiki')}
            />
          </label>
          {searching && (
            <div className="flex items-center justify-between gap-2 sm:justify-start">
              <span className="text-[16px] text-dim" aria-live="polite">
                {result.entryCount > 0
                  ? t('{results} in {sections}', {
                      results: result.entryCount === 1 ? t('1 result') : t('{n} results', { n: result.entryCount }),
                      sections: result.sections.length === 1 ? t('1 section') : t('{n} sections', { n: result.sections.length }),
                    })
                  : t('No results')}
              </span>
              <PixelButton size="xs" variant="ghost" icon={<X size={10} />} onClick={() => { setQuery(''); searchRef.current?.focus(); }}>
                {t('Clear search')}
              </PixelButton>
            </div>
          )}
        </div>

        {navSections.length > 0 && (
          <select
            className="retro-input w-full md:hidden"
            value={searching ? '' : active.id}
            onChange={(e) => e.target.value && openSection(e.target.value)}
            aria-label={t('Section')}
          >
            {searching && <option value="">{t('Go to a section…')}</option>}
            {navSections.map((s) => (
              <option key={s.id} value={s.id}>
                {`${WIKI_SECTIONS.findIndex((x) => x.id === s.id) + 1}. ${s.title}${searching ? ` (${s.entries.length})` : ''}`}
              </option>
            ))}
          </select>
        )}

        <div className="flex min-h-0 flex-1 gap-3">
          <nav className="retro-scroll hidden w-56 shrink-0 flex-col gap-0.5 overflow-y-auto pr-1 md:flex" aria-label={t('Wiki sections')}>
            {navSections.map((s) => {
              const Icon = SECTION_ICONS[s.icon];
              const current = !searching && s.id === active.id;
              const n = countFor(s);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => openSection(s.id)}
                  aria-current={current ? 'page' : undefined}
                  className={cn('flex items-center gap-2 px-2 py-1.5 text-left font-silk text-[11px] uppercase leading-tight transition-colors', !current && 'hover:bg-panel-3')}
                  style={current ? { color: '#07060f', background: s.color, boxShadow: `0 0 10px ${s.color}66` } : { color: s.color, background: '#141128' }}
                >
                  <Icon size={13} className="shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1">{s.title}</span>
                  {n !== null && <span className="font-term text-[15px] normal-case text-dim">{n}</span>}
                </button>
              );
            })}
            {searching && navSections.length === 0 && <p className="px-2 text-[16px] text-dim">{t('Nothing matches.')}</p>}
          </nav>

          <div ref={contentRef} className="retro-scroll min-w-0 flex-1 overflow-y-auto overflow-x-hidden pr-1 text-[17px]" data-testid="wiki-content">
            {shown.length === 0 && (
              <div className="flex flex-col items-start gap-2 p-2 text-dim">
                <p>{t('Nothing about “{query}”. Try another word (for example: paste, brownout, bots, $SC).', { query: query.trim() })}</p>
                <PixelButton size="sm" variant="primary" onClick={() => setQuery('')}>
                  {t('Show the whole wiki')}
                </PixelButton>
              </div>
            )}

            {shown.map((section) => (
              <article key={section.id} id={anchorId(section.id)} className="mb-5 flex scroll-mt-2 flex-col gap-4" data-wiki-section={section.id}>
                <SectionHeader section={section} hl={hl} />
                {!searching && section.entries.length > 1 && (
                  <div className="flex flex-wrap gap-1" aria-label={t('In this section')}>
                    {section.entries.map((e) => (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => scrollTo(anchorId(section.id, e.id))}
                        className="bg-panel-2 px-2 py-0.5 text-[15px] leading-tight text-dim hover:bg-panel-3 hover:text-ink"
                      >
                        {e.title}
                      </button>
                    ))}
                  </div>
                )}
                {section.entries.map((entry) => (
                  <EntryView key={entry.id} section={section} entry={entry} hl={hl} />
                ))}
              </article>
            ))}

            {!searching && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t-2 border-[#1b1838] pt-3">
                <PixelButton
                  size="sm"
                  icon={<ChevronLeft size={12} />}
                  disabled={activeIndex <= 0}
                  onClick={() => setActiveId(WIKI_SECTIONS[activeIndex - 1].id)}
                >
                  {activeIndex > 0 ? WIKI_SECTIONS[activeIndex - 1].title : t('First page')}
                </PixelButton>
                <PixelButton
                  size="sm"
                  variant="primary"
                  disabled={activeIndex >= WIKI_SECTIONS.length - 1}
                  onClick={() => setActiveId(WIKI_SECTIONS[activeIndex + 1].id)}
                >
                  {activeIndex < WIKI_SECTIONS.length - 1 ? WIKI_SECTIONS[activeIndex + 1].title : t('Last page')}
                  <ChevronRight size={12} />
                </PixelButton>
              </div>
            )}
          </div>
        </div>
      </div>
    </PixelModal>
  );
}
