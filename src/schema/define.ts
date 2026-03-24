import type { TransitionCondition, TransitionRule, ManualTransition } from '../engine/types.js';

/**
 * Entity definition with compile-time type safety for statuses and preset names.
 */
export interface EntityDefinition<
  TStatuses extends readonly string[],
  TPresetNames extends readonly string[],
> {
  name: string;
  statuses: TStatuses;
  transitions?: Array<{
    from: TStatuses[number];
    to: TStatuses[number];
    conditions?: Array<{
      fn: TPresetNames[number];
      args: Record<string, unknown>;
    }>;
  }>;
  manualTransitions?: Array<{
    from: TStatuses[number] | 'ANY';
    to: TStatuses[number];
  }>;
}

/**
 * Schema definition grouping multiple entity definitions.
 */
export interface SchemaDefinition<TPresetNames extends readonly string[]> {
  presetNames: TPresetNames;
  entities: Record<string, EntityDefinition<readonly string[], TPresetNames>>;
  policy?: {
    mode: 'strict' | 'warn' | 'off';
  };
}

/**
 * Define a single entity with type-safe statuses and preset names.
 * Using `const` generics for literal tuple inference.
 */
export function defineEntity<
  const TStatuses extends readonly string[],
  const TPresetNames extends readonly string[],
>(
  presetNames: TPresetNames,
  definition: EntityDefinition<TStatuses, TPresetNames>,
): EntityDefinition<TStatuses, TPresetNames> {
  return definition;
}

/**
 * Define a schema grouping multiple entities with shared preset names.
 */
export function defineSchema<const TPresetNames extends readonly string[]>(
  definition: SchemaDefinition<TPresetNames>,
): SchemaDefinition<TPresetNames> {
  return definition;
}

/**
 * Extract TransitionRule[] from an entity definition for use with the engine.
 */
export function extractRules(
  entity: EntityDefinition<readonly string[], readonly string[]>,
): TransitionRule[] {
  if (!entity.transitions) return [];

  return entity.transitions.map((t) => ({
    from: t.from,
    to: t.to,
    conditions: (t.conditions ?? []) as TransitionCondition[],
  }));
}

/**
 * Extract ManualTransition[] from an entity definition for use with the engine.
 */
export function extractManualTransitions(
  entity: EntityDefinition<readonly string[], readonly string[]>,
): ManualTransition[] {
  if (!entity.manualTransitions) return [];

  return entity.manualTransitions.map((mt) => ({
    from: mt.from,
    to: mt.to,
  }));
}
