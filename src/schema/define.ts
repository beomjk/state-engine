import type { TransitionCondition, TransitionRule, ManualTransition } from '../engine/types.js';

/**
 * Type-level mapping from preset name to its expected argument shape (FR-016).
 */
export type PresetArgsMap = Record<string, Record<string, unknown>>;

/**
 * Entity definition with compile-time type safety for statuses, preset names, and args.
 */
export interface EntityDefinition<
  TStatuses extends readonly string[],
  TPresetNames extends readonly string[],
  TArgsMap extends PresetArgsMap = PresetArgsMap,
> {
  name: string;
  statuses: TStatuses;
  transitions?: Array<{
    from: TStatuses[number];
    to: TStatuses[number];
    conditions?: Array<{
      [K in TPresetNames[number]]: {
        fn: K;
        args: K extends keyof TArgsMap ? TArgsMap[K] : Record<string, unknown>;
      };
    }[TPresetNames[number]]>;
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entities: Record<string, EntityDefinition<readonly string[], TPresetNames, any>>;
  policy?: {
    mode: 'strict' | 'warn' | 'off';
  };
}

/**
 * A definer with preset args type safety.
 * Created via `createDefiner(presetNames).withArgs<ArgsMap>()`.
 */
export interface Definer<
  TPresetNames extends readonly string[],
  TArgsMap extends PresetArgsMap,
> {
  entity<const TStatuses extends readonly string[]>(
    definition: EntityDefinition<TStatuses, TPresetNames, TArgsMap>,
  ): EntityDefinition<TStatuses, TPresetNames, TArgsMap>;
}

/**
 * Intermediate definer before args type is specified.
 * Call `.withArgs<ArgsMap>()` for full type safety, or `.entity()` for status/preset-name checking only.
 */
export interface DefinerWithoutArgs<TPresetNames extends readonly string[]> {
  withArgs<TArgsMap extends PresetArgsMap>(): Definer<TPresetNames, TArgsMap>;
  entity<const TStatuses extends readonly string[]>(
    definition: EntityDefinition<TStatuses, TPresetNames>,
  ): EntityDefinition<TStatuses, TPresetNames>;
}

/**
 * Create a type-safe entity definer for the given preset names.
 * Optionally chain `.withArgs<ArgsMap>()` for preset argument type checking.
 *
 * @example
 * const define = createDefiner(['field_present', 'field_equals'] as const)
 *   .withArgs<BuiltinPresetArgsMap>();
 * const entity = define.entity({ name: 'Hypothesis', statuses: [...], transitions: [...] });
 */
export function createDefiner<const TPresetNames extends readonly string[]>(
  _presetNames: TPresetNames,
): DefinerWithoutArgs<TPresetNames> {
  return {
    withArgs<TArgsMap extends PresetArgsMap>(): Definer<TPresetNames, TArgsMap> {
      return {
        entity<const TStatuses extends readonly string[]>(
          definition: EntityDefinition<TStatuses, TPresetNames, TArgsMap>,
        ): EntityDefinition<TStatuses, TPresetNames, TArgsMap> {
          return definition;
        },
      };
    },
    entity<const TStatuses extends readonly string[]>(
      definition: EntityDefinition<TStatuses, TPresetNames>,
    ): EntityDefinition<TStatuses, TPresetNames> {
      return definition;
    },
  };
}

/**
 * Define a single entity with type-safe statuses, preset names, and args.
 * @deprecated Use `createDefiner(presetNames).withArgs<ArgsMap>().entity(definition)` instead.
 */
export function defineEntity<
  const TStatuses extends readonly string[],
  const TPresetNames extends readonly string[],
  TArgsMap extends PresetArgsMap = Record<TPresetNames[number], Record<string, unknown>>,
>(
  presetNames: TPresetNames,
  argsMap: TArgsMap,
  definition: EntityDefinition<TStatuses, TPresetNames, TArgsMap>,
): EntityDefinition<TStatuses, TPresetNames, TArgsMap> {
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entity: EntityDefinition<readonly string[], readonly string[], any>,
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entity: EntityDefinition<readonly string[], readonly string[], any>,
): ManualTransition[] {
  if (!entity.manualTransitions) return [];

  return entity.manualTransitions.map((mt) => ({
    from: mt.from,
    to: mt.to,
  }));
}
