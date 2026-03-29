import type { Entity, PresetResult, TransitionRule, ManualTransition } from '../../src/engine/types.js';
import type { RelationDefinition, RelationInstance } from '../../src/orchestrator/types.js';

// --- Preset helpers ---

export const alwaysMet = (_e: Entity, _c: unknown, _a: Record<string, unknown>): PresetResult => ({
  met: true,
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

/**
 * Preset that throws a raw string (for testing the String(err) fallback path).
 */
export const throwingNonErrorPreset = (): PresetResult => {
  throw 'raw string error';
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

/**
 * Build a linear chain of N entity types with connecting relations.
 * type_0 → type_1 → ... → type_(length-1), each with an always_met IDLE→ACTIVE rule.
 */
export function buildChain(length: number): {
  machines: Record<string, { rules: TransitionRule[]; manualTransitions: ManualTransition[] }>;
  entities: Map<string, Entity>;
  relations: RelationDefinition[];
  relationInstances: RelationInstance[];
} {
  const machines: Record<string, { rules: TransitionRule[]; manualTransitions: ManualTransition[] }> = {};
  const entities = new Map<string, Entity>();
  const relations: RelationDefinition[] = [];
  const relationInstances: RelationInstance[] = [];

  for (let i = 0; i < length; i++) {
    const typeName = `type_${i}`;
    machines[typeName] = {
      rules: i === 0
        ? []
        : [{ from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] }],
      manualTransitions: [],
    };
    entities.set(`e${i}`, { id: `e${i}`, type: typeName, status: 'IDLE', meta: {} });
  }

  for (let i = 0; i < length - 1; i++) {
    const relName = `rel_${i}_${i + 1}`;
    relations.push({ name: relName, source: `type_${i}`, target: `type_${i + 1}` });
    relationInstances.push({ name: relName, sourceId: `e${i}`, targetId: `e${i + 1}` });
  }

  return { machines, entities, relations, relationInstances };
}
