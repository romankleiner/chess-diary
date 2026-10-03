import { describe, it, expect } from 'vitest';
import {
  DEFAULT_AI_MODEL,
  FALLBACK_MODELS,
  buildModelGroups,
  compareNewestFirst,
  familyOf,
  newerModelHint,
  normalizeModelId,
  parseModelList,
  type ModelInfo,
} from '@/lib/model-catalog';

// ─── helpers ──────────────────────────────────────────────────────────────────

const model = (id: string, displayName = id, createdAt: string | null = null): ModelInfo => ({
  id,
  displayName,
  createdAt,
  family: familyOf(id),
});

/** A model list like the one the API returns today. */
const CURRENT = [
  model('claude-fable-5', 'Claude Fable 5'),
  model('claude-opus-4-8', 'Claude Opus 4.8'),
  model('claude-opus-4-7', 'Claude Opus 4.7'),
  model('claude-opus-4-6', 'Claude Opus 4.6'),
  model('claude-opus-4-5-20251101', 'Claude Opus 4.5'),
  model('claude-sonnet-5', 'Claude Sonnet 5'),
  model('claude-sonnet-4-6', 'Claude Sonnet 4.6'),
  model('claude-sonnet-4-5-20250929', 'Claude Sonnet 4.5'),
  model('claude-haiku-4-5-20251001', 'Claude Haiku 4.5'),
  model('claude-3-haiku-20240307', 'Claude Haiku 3'),
];

const ids = (options: { id: string }[]) => options.map(o => o.id);
const group = (groups: { label: string }[], label: string) => groups.find(g => g.label === label) as any;

// ─── identifying models ───────────────────────────────────────────────────────

describe('familyOf', () => {
  it.each([
    ['claude-fable-5', 'fable'],
    ['claude-mythos-5', 'mythos'],
    ['claude-opus-4-8', 'opus'],
    ['claude-3-opus-20240229', 'opus'],
    ['claude-sonnet-5', 'sonnet'],
    ['claude-3-5-sonnet-20241022', 'sonnet'],
    ['claude-haiku-4-5-20251001', 'haiku'],
    ['claude-2.1', 'other'],
    ['claude-nova-1', 'other'],
  ])('%s → %s', (id, family) => {
    expect(familyOf(id)).toBe(family);
  });
});

describe('normalizeModelId', () => {
  it('strips snapshot dates and -latest', () => {
    expect(normalizeModelId('claude-haiku-4-5-20251001')).toBe('claude-haiku-4-5');
    expect(normalizeModelId('claude-3-7-sonnet-latest')).toBe('claude-3-7-sonnet');
  });

  it('leaves ids without a suffix alone', () => {
    expect(normalizeModelId('claude-opus-4-8')).toBe('claude-opus-4-8');
    expect(normalizeModelId('claude-sonnet-5')).toBe('claude-sonnet-5');
  });
});

describe('compareNewestFirst', () => {
  const sorted = (list: ModelInfo[]) => [...list].sort(compareNewestFirst).map(m => m.id);

  it('orders by version, newest first', () => {
    expect(
      sorted([model('claude-opus-4-6'), model('claude-opus-4-8'), model('claude-opus-4-7')])
    ).toEqual(['claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6']);
  });

  it('puts a major version above every minor of the previous one', () => {
    expect(sorted([model('claude-sonnet-4-6'), model('claude-sonnet-5')])).toEqual([
      'claude-sonnet-5',
      'claude-sonnet-4-6',
    ]);
  });

  it('handles the older "claude-3-5-…" naming and dated snapshots', () => {
    expect(
      sorted([
        model('claude-3-5-sonnet-20240620'),
        model('claude-sonnet-4-20250514'),
        model('claude-3-7-sonnet-20250219'),
        model('claude-sonnet-4-5-20250929'),
      ])
    ).toEqual([
      'claude-sonnet-4-5-20250929',
      'claude-sonnet-4-20250514',
      'claude-3-7-sonnet-20250219',
      'claude-3-5-sonnet-20240620',
    ]);
  });

  it('ranks "4" below "4.1"', () => {
    expect(sorted([model('claude-opus-4-20250514'), model('claude-opus-4-1-20250805')])).toEqual([
      'claude-opus-4-1-20250805',
      'claude-opus-4-20250514',
    ]);
  });

  it('breaks a version tie by release date, then by id', () => {
    expect(
      sorted([
        model('claude-opus-4-8', 'a', '2026-01-01T00:00:00Z'),
        model('claude-opus-4-8-20260301', 'b', '2026-03-01T00:00:00Z'),
      ])
    ).toEqual(['claude-opus-4-8-20260301', 'claude-opus-4-8']);
  });
});

// ─── reading the API response ─────────────────────────────────────────────────

describe('parseModelList', () => {
  it('reads id, display name and release date from a Models API page', () => {
    const parsed = parseModelList({
      data: [
        { type: 'model', id: 'claude-opus-4-8', display_name: 'Claude Opus 4.8', created_at: '2026-05-01T00:00:00Z' },
      ],
      has_more: false,
    });

    expect(parsed).toEqual([
      { id: 'claude-opus-4-8', displayName: 'Claude Opus 4.8', createdAt: '2026-05-01T00:00:00Z', family: 'opus' },
    ]);
  });

  it('builds a readable name when the API gives none', () => {
    expect(parseModelList({ data: [{ id: 'claude-opus-4-8' }] })[0].displayName).toBe('Claude Opus 4.8');
    expect(parseModelList({ data: [{ id: 'claude-sonnet-5', display_name: '  ' }] })[0].displayName).toBe(
      'Claude Sonnet 5'
    );
  });

  it('ignores anything that is not a Claude model, and malformed items', () => {
    const parsed = parseModelList({
      data: [
        { id: 'gpt-4o' },
        { id: 42 },
        null,
        'claude-opus-4-8',
        {},
        { id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5' },
      ],
    });
    expect(parsed.map(m => m.id)).toEqual(['claude-haiku-4-5']);
  });

  it('drops duplicate ids', () => {
    const parsed = parseModelList({ data: [{ id: 'claude-opus-4-8' }, { id: 'claude-opus-4-8' }] });
    expect(parsed).toHaveLength(1);
  });

  it('copes with a missing or malformed payload', () => {
    expect(parseModelList(null)).toEqual([]);
    expect(parseModelList(undefined)).toEqual([]);
    expect(parseModelList({})).toEqual([]);
    expect(parseModelList({ data: 'nope' })).toEqual([]);
  });

  it('keeps models from families it has not heard of', () => {
    expect(parseModelList({ data: [{ id: 'claude-nova-1' }] })[0].family).toBe('other');
  });
});

describe('FALLBACK_MODELS', () => {
  it('has unique ids and a consistent family for each', () => {
    expect(new Set(FALLBACK_MODELS.map(m => m.id)).size).toBe(FALLBACK_MODELS.length);
    for (const m of FALLBACK_MODELS) expect(m.family).toBe(familyOf(m.id));
  });

  it('includes the default model, so the dropdown can always show it', () => {
    expect(FALLBACK_MODELS.map(m => m.id)).toContain(DEFAULT_AI_MODEL);
  });
});

// ─── the dropdown ─────────────────────────────────────────────────────────────

describe('buildModelGroups', () => {
  it('lists the newest model of each family first, most capable family first', () => {
    const { groups } = buildModelGroups(CURRENT, null);

    expect(ids(group(groups, 'Current models').options)).toEqual([
      'claude-fable-5',
      'claude-opus-4-8',
      'claude-sonnet-5',
      'claude-haiku-4-5-20251001',
    ]);
  });

  it('keeps only the two next-newest models per family as previous generations', () => {
    const { groups } = buildModelGroups(CURRENT, null);

    expect(ids(group(groups, 'Previous generations').options)).toEqual([
      'claude-opus-4-7',
      'claude-opus-4-6', // Opus 4.5 is the third-newest, so it is left out
      'claude-sonnet-4-6',
      'claude-sonnet-4-5-20250929',
      'claude-3-haiku-20240307',
    ]);
  });

  it('describes each current model and marks the recommended one', () => {
    const { groups } = buildModelGroups(CURRENT, null);
    const labels = Object.fromEntries(group(groups, 'Current models').options.map((o: any) => [o.id, o.label]));

    expect(labels['claude-fable-5']).toBe('Claude Fable 5 — most capable');
    expect(labels['claude-sonnet-5']).toBe('Claude Sonnet 5 — balanced · recommended');
    expect(labels['claude-haiku-4-5-20251001']).toBe('Claude Haiku 4.5 — fast & cheap');
  });

  it('shows a brand-new model at the top of its family without moving the recommendation', () => {
    const { groups } = buildModelGroups([model('claude-sonnet-6', 'Claude Sonnet 6'), ...CURRENT], null);
    const current = group(groups, 'Current models').options;
    const previous = group(groups, 'Previous generations').options;

    expect(ids(current)).toContain('claude-sonnet-6');
    expect(ids(current)).not.toContain('claude-sonnet-5');
    expect(ids(previous)).toContain('claude-sonnet-5');
    // The recommendation follows DEFAULT_AI_MODEL, not "whatever is newest".
    expect(previous.find((o: any) => o.id === 'claude-sonnet-5').label).toContain('recommended');
    expect(current.find((o: any) => o.id === 'claude-sonnet-6').label).not.toContain('recommended');
  });

  it('puts models from an unknown family under "Other models", capped', () => {
    const many = Array.from({ length: 6 }, (_, i) => model(`claude-nova-${i + 1}`, `Claude Nova ${i + 1}`));
    const { groups } = buildModelGroups([...CURRENT, ...many], null);

    const other = group(groups, 'Other models').options;
    expect(other).toHaveLength(4);
    expect(other[0].id).toBe('claude-nova-6');
  });

  it('leaves out groups that would be empty', () => {
    const { groups } = buildModelGroups([model('claude-opus-4-8', 'Claude Opus 4.8')], null);
    expect(groups.map(g => g.label)).toEqual(['Current models']);
  });

  it('copes with an empty list', () => {
    expect(buildModelGroups([], null)).toEqual({ groups: [], selectedValue: null });
  });

  describe('the saved choice', () => {
    it('is selected when it is listed', () => {
      expect(buildModelGroups(CURRENT, 'claude-opus-4-8').selectedValue).toBe('claude-opus-4-8');
    });

    it('is null when nothing is saved', () => {
      expect(buildModelGroups(CURRENT, null).selectedValue).toBeNull();
      expect(buildModelGroups(CURRENT, undefined).selectedValue).toBeNull();
    });

    it('matches a saved alias to the dated id the API lists', () => {
      const { selectedValue, groups } = buildModelGroups(CURRENT, 'claude-haiku-4-5');
      expect(selectedValue).toBe('claude-haiku-4-5-20251001');
      expect(groups.some(g => g.label === 'Your saved setting')).toBe(false);
    });

    it('is added under its own heading when it is listed but older than what is shown', () => {
      const { selectedValue, groups } = buildModelGroups(CURRENT, 'claude-opus-4-5-20251101');
      expect(selectedValue).toBe('claude-opus-4-5-20251101');
      expect(group(groups, 'Your saved setting').options).toEqual([
        { id: 'claude-opus-4-5-20251101', label: 'Claude Opus 4.5' },
      ]);
    });

    it('says so when it is no longer on Anthropic’s list, but is still selectable', () => {
      const { selectedValue, groups } = buildModelGroups(CURRENT, 'claude-3-5-sonnet-20240620');
      expect(selectedValue).toBe('claude-3-5-sonnet-20240620');
      expect(group(groups, 'Your saved setting').options[0].label).toBe(
        'claude-3-5-sonnet-20240620 (no longer available)'
      );
    });

    it('does not claim a model is gone when the list is only the built-in fallback', () => {
      const { groups } = buildModelGroups(FALLBACK_MODELS, 'claude-opus-4-5', { authoritative: false });
      expect(group(groups, 'Your saved setting').options[0].label).toBe('claude-opus-4-5 (saved setting)');
    });
  });
});

// ─── suggesting a newer model ─────────────────────────────────────────────────

describe('newerModelHint', () => {
  it('suggests the newest model in the same family when the saved one is older', () => {
    expect(newerModelHint('claude-sonnet-4-6', CURRENT)?.id).toBe('claude-sonnet-5');
    expect(newerModelHint('claude-opus-4-6', CURRENT)?.id).toBe('claude-opus-4-8');
  });

  it('suggests nothing when the saved model is already the newest', () => {
    expect(newerModelHint('claude-sonnet-5', CURRENT)).toBeNull();
    expect(newerModelHint('claude-opus-4-8', CURRENT)).toBeNull();
  });

  it('treats a saved alias of the newest model as the newest', () => {
    expect(newerModelHint('claude-haiku-4-5', CURRENT)).toBeNull();
  });

  it('suggests a newer model from a retired one', () => {
    expect(newerModelHint('claude-3-5-sonnet-20240620', CURRENT)?.id).toBe('claude-sonnet-5');
  });

  it('never crosses families', () => {
    // Fable 5 is the newest model overall, but a Sonnet user is only told about Sonnets.
    expect(newerModelHint('claude-sonnet-5', CURRENT)).toBeNull();
  });

  it('suggests nothing when there is no saved model, no family, or no list', () => {
    expect(newerModelHint(null, CURRENT)).toBeNull();
    expect(newerModelHint('claude-nova-1', CURRENT)).toBeNull();
    expect(newerModelHint('claude-sonnet-4-6', [])).toBeNull();
  });

  it('does not suggest an older model to someone already ahead of the list', () => {
    expect(newerModelHint('claude-sonnet-7', CURRENT)).toBeNull();
  });
});
