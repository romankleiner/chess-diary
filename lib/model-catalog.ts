/**
 * The list of Claude models offered for AI analysis — pure logic, no I/O, safe
 * to import from both the server and the browser. (Fetching and caching the
 * list from Anthropic lives in lib/model-catalog-server.ts.)
 *
 * The Settings dropdown used to be a hand-edited list that went stale whenever a
 * model shipped. Now the list comes from Anthropic's Models API; this module
 * turns that raw list into something sensible to show: newest first, grouped by
 * family, with a bounded number of older models, and graceful handling of a
 * saved choice that is no longer on the list.
 *
 * The list is refreshed automatically; the SELECTED model never is. A newer
 * model can change cost and behaviour (Sonnet 5 uses a different tokenizer, for
 * example), so we only suggest it.
 */

export type ModelFamily = 'fable' | 'mythos' | 'opus' | 'sonnet' | 'haiku' | 'other';

export interface ModelInfo {
  id: string;
  displayName: string;
  /** Release timestamp from the API (ISO 8601); null for the built-in fallback list. */
  createdAt: string | null;
  family: ModelFamily;
}

/**
 * Model used when the user has never chosen one. Deliberately fixed rather than
 * "latest Sonnet": a default that moved on its own would change cost and
 * behaviour for people who never touched the setting.
 */
export const DEFAULT_AI_MODEL = 'claude-sonnet-5';

/** Shown only if Anthropic's list cannot be fetched and nothing is cached. */
export const FALLBACK_MODELS: ModelInfo[] = [
  { id: 'claude-fable-5', displayName: 'Claude Fable 5', createdAt: null, family: 'fable' },
  { id: 'claude-opus-4-8', displayName: 'Claude Opus 4.8', createdAt: null, family: 'opus' },
  { id: 'claude-opus-4-7', displayName: 'Claude Opus 4.7', createdAt: null, family: 'opus' },
  { id: 'claude-opus-4-6', displayName: 'Claude Opus 4.6', createdAt: null, family: 'opus' },
  { id: 'claude-sonnet-5', displayName: 'Claude Sonnet 5', createdAt: null, family: 'sonnet' },
  { id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6', createdAt: null, family: 'sonnet' },
  { id: 'claude-haiku-4-5', displayName: 'Claude Haiku 4.5', createdAt: null, family: 'haiku' },
];

// ─── identifying models ──────────────────────────────────────────────────────

export function familyOf(id: string): ModelFamily {
  const lower = id.toLowerCase();
  if (lower.includes('fable')) return 'fable';
  if (lower.includes('mythos')) return 'mythos';
  if (lower.includes('opus')) return 'opus';
  if (lower.includes('sonnet')) return 'sonnet';
  if (lower.includes('haiku')) return 'haiku';
  return 'other';
}

/**
 * The same model can be spelled with or without a snapshot date
 * ("claude-haiku-4-5" vs "claude-haiku-4-5-20251001") or as "-latest".
 * Strip those so a saved alias still matches the dated ID the API lists.
 */
export function normalizeModelId(id: string): string {
  return id.replace(/-(\d{8}|latest)$/, '');
}

/** Numeric version parts: claude-opus-4-8 → [4, 8]; claude-3-5-sonnet-… → [3, 5]; claude-sonnet-5 → [5]. */
function versionOf(id: string): number[] {
  return normalizeModelId(id)
    .split(/[-.]/)
    .filter(part => /^\d+$/.test(part))
    .map(Number);
}

/** Sort comparator: newest model first. Version beats release date beats id. */
export function compareNewestFirst(a: ModelInfo, b: ModelInfo): number {
  const av = versionOf(a.id);
  const bv = versionOf(b.id);
  for (let i = 0; i < Math.max(av.length, bv.length); i++) {
    const diff = (bv[i] ?? -1) - (av[i] ?? -1);
    if (diff !== 0) return diff;
  }
  return (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || b.id.localeCompare(a.id);
}

// ─── reading the API response ────────────────────────────────────────────────

/** "claude-opus-4-8" → "Claude Opus 4.8" — only used if the API gives no display_name. */
function prettifyId(id: string): string {
  const words = normalizeModelId(id).split('-');
  const name: string[] = [];
  const version: string[] = [];
  for (const word of words) (/^\d+$/.test(word) ? version : name).push(word);
  const title = name.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  return version.length ? `${title} ${version.join('.')}` : title;
}

/**
 * Pull the usable models out of a Models API page ({ data: [{ id, display_name,
 * created_at, … }] }). Ignores anything malformed rather than failing, and
 * removes duplicate IDs.
 */
export function parseModelList(payload: unknown): ModelInfo[] {
  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];

  const seen = new Set<string>();
  const models: ModelInfo[] = [];
  for (const item of data) {
    const record = item as { id?: unknown; display_name?: unknown; created_at?: unknown } | null;
    const id = record?.id;
    if (typeof id !== 'string' || !id.startsWith('claude-') || seen.has(id)) continue;
    seen.add(id);
    models.push({
      id,
      displayName:
        typeof record?.display_name === 'string' && record.display_name.trim()
          ? record.display_name.trim()
          : prettifyId(id),
      createdAt: typeof record?.created_at === 'string' ? record.created_at : null,
      family: familyOf(id),
    });
  }
  return models;
}

// ─── building the dropdown ───────────────────────────────────────────────────

export interface ModelOption {
  id: string;
  label: string;
}

export interface ModelGroup {
  label: string;
  options: ModelOption[];
}

export interface ModelGroups {
  groups: ModelGroup[];
  /** The option value to show as selected, or null if nothing is saved. */
  selectedValue: string | null;
}

// Most capable first.
const FAMILY_ORDER: ModelFamily[] = ['fable', 'mythos', 'opus', 'sonnet', 'haiku'];
const FAMILY_NOTE: Partial<Record<ModelFamily, string>> = {
  fable: 'most capable',
  mythos: 'Project Glasswing',
  opus: 'highly capable',
  sonnet: 'balanced',
  haiku: 'fast & cheap',
};
/** How many older models to keep per family, so the list stays short. */
const PREVIOUS_PER_FAMILY = 2;
const OTHER_LIMIT = 4;

/**
 * Group the models for the dropdown: the newest of each family first, then a
 * few older ones, then anything unrecognised. A saved choice that would not
 * otherwise appear is added so the dropdown never misrepresents it.
 *
 * `authoritative` is false when the list is the built-in fallback; a saved model
 * missing from it then isn't claimed to be "no longer available".
 */
export function buildModelGroups(
  models: ModelInfo[],
  selectedId: string | null | undefined,
  { authoritative = true }: { authoritative?: boolean } = {},
): ModelGroups {
  const byFamily = new Map<ModelFamily, ModelInfo[]>();
  for (const model of [...models].sort(compareNewestFirst)) {
    byFamily.set(model.family, [...(byFamily.get(model.family) ?? []), model]);
  }

  const label = (model: ModelInfo, note?: string) => {
    const tags = [note, normalizeModelId(model.id) === DEFAULT_AI_MODEL ? 'recommended' : null].filter(Boolean);
    return tags.length ? `${model.displayName} — ${tags.join(' · ')}` : model.displayName;
  };

  const current: ModelOption[] = [];
  const previous: ModelOption[] = [];
  for (const family of FAMILY_ORDER) {
    const [newest, ...older] = byFamily.get(family) ?? [];
    if (!newest) continue;
    current.push({ id: newest.id, label: label(newest, FAMILY_NOTE[family]) });
    for (const model of older.slice(0, PREVIOUS_PER_FAMILY)) previous.push({ id: model.id, label: label(model) });
  }
  const other = (byFamily.get('other') ?? []).slice(0, OTHER_LIMIT).map(m => ({ id: m.id, label: label(m) }));

  const groups: ModelGroup[] = [
    { label: 'Current models', options: current },
    { label: 'Previous generations', options: previous },
    { label: 'Other models', options: other },
  ].filter(group => group.options.length > 0);

  // Make sure the saved choice is selectable and described honestly.
  let selectedValue: string | null = null;
  if (selectedId) {
    const shown = groups.flatMap(g => g.options);
    const match =
      shown.find(o => o.id === selectedId) ??
      shown.find(o => normalizeModelId(o.id) === normalizeModelId(selectedId));

    if (match) {
      selectedValue = match.id;
    } else {
      const known = models.find(m => normalizeModelId(m.id) === normalizeModelId(selectedId));
      groups.push({
        label: 'Your saved setting',
        options: [
          {
            id: selectedId,
            label: known
              ? known.displayName
              : authoritative
                ? `${selectedId} (no longer available)`
                : `${selectedId} (saved setting)`,
          },
        ],
      });
      selectedValue = selectedId;
    }
  }

  return { groups, selectedValue };
}

/**
 * The newest model in the same family as the selected one, if it is newer —
 * for a suggestion only. The selection is never changed automatically.
 */
export function newerModelHint(selectedId: string | null | undefined, models: ModelInfo[]): ModelInfo | null {
  if (!selectedId) return null;
  const family = familyOf(selectedId);
  if (family === 'other') return null;

  const newest = models.filter(m => m.family === family).sort(compareNewestFirst)[0];
  if (!newest || normalizeModelId(newest.id) === normalizeModelId(selectedId)) return null;

  const selected: ModelInfo = { id: selectedId, displayName: selectedId, createdAt: null, family };
  return compareNewestFirst(newest, selected) < 0 ? newest : null;
}
