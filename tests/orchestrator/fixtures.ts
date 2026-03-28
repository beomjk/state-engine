import type { Entity, TransitionRule, ManualTransition, PresetResult } from '../../src/engine/types.js';
import type { RelationDefinition, RelationInstance } from '../../src/orchestrator/types.js';

// --- Preset helpers ---

export const alwaysMet = (_e: Entity, _c: unknown, _a: Record<string, unknown>): PresetResult => ({
  met: true,
  matchedIds: [],
});

export const neverMet = (_e: Entity, _c: unknown, _a: Record<string, unknown>): PresetResult => ({
  met: false,
  matchedIds: [],
});

/**
 * Preset that checks entity.meta[field] === value.
 */
export const fieldEquals = (
  entity: Entity,
  _context: unknown,
  args: Record<string, unknown>,
): PresetResult => ({
  met: entity.meta[args.field as string] === args.value,
  matchedIds: [],
});

/**
 * Preset that returns met=true and specific matchedIds.
 */
export const returnsIds = (
  _entity: Entity,
  _context: unknown,
  args: Record<string, unknown>,
): PresetResult => ({
  met: true,
  matchedIds: (args.ids as string[]) ?? [],
});

/**
 * Preset that always throws (for error testing).
 */
export const throwingPreset = (): PresetResult => {
  throw new Error('Preset evaluation failed');
};

// --- Entity builders ---

export function buildEntityMap(...entities: Entity[]): Map<string, Entity> {
  return new Map(entities.map((e) => [e.id, e]));
}

export function makeEntity(
  id: string,
  type: string,
  status: string,
  meta: Record<string, unknown> = {},
): Entity {
  return { id, type, status, meta };
}

// --- Sample entity definitions ---

export const hypothesisRules: TransitionRule[] = [
  {
    from: 'PROPOSED',
    to: 'TESTING',
    conditions: [{ fn: 'field_equals', args: { field: 'hasExperiment', value: true } }],
  },
  {
    from: 'TESTING',
    to: 'SUPPORTED',
    conditions: [{ fn: 'field_equals', args: { field: 'allCompleted', value: true } }],
  },
];

export const hypothesisManual: ManualTransition[] = [
  { from: 'TESTING', to: 'RETRACTED' },
];

export const experimentRules: TransitionRule[] = [
  {
    from: 'DESIGNED',
    to: 'RUNNING',
    conditions: [{ fn: 'field_equals', args: { field: 'approved', value: true } }],
  },
];

export const experimentManual: ManualTransition[] = [
  { from: 'RUNNING', to: 'COMPLETED' },
  { from: 'RUNNING', to: 'FAILED' },
];

// --- Sample relations ---

export const sampleRelationDefs: RelationDefinition[] = [
  {
    name: 'tests',
    source: 'experiment',
    target: 'hypothesis',
    // default direction: experiment changes -> re-evaluate hypothesis
  },
];

export function buildRelationInstances(
  ...instances: [name: string, sourceId: string, targetId: string][]
): RelationInstance[] {
  return instances.map(([name, sourceId, targetId]) => ({ name, sourceId, targetId }));
}
