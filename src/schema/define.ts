import type { TransitionCondition, TransitionRule, ManualTransition } from '../engine/types.js';

/**
 * Type-level mapping from preset name to its expected argument shape (FR-016).
 */
export type PresetArgsMap = Record<string, Record<string, unknown>>;

/**
 * Declares a named, typed connection between two entity types.
 */
export interface RelationDefinition {
  name: string;
  source: string;
  target: string;
  direction?: 'default' | 'reverse';
  metadata?: Record<string, unknown>;
}

/**
 * Runtime representation of a concrete relation between two entity instances.
 */
export interface RelationInstance {
  name: string;
  sourceId: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}

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
    conditions?: Array<
      {
        [K in TPresetNames[number]]: {
          fn: K;
          args: K extends keyof TArgsMap ? TArgsMap[K] : Record<string, unknown>;
        };
      }[TPresetNames[number]]
    >;
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
  relations?: RelationDefinition[];
  policy?: {
    /**
     * Metadata only — the engine does not enforce this (FR-015).
     * Consumers inspect `schema.policy.mode` to decide enforcement strategy:
     * e.g., throw in CLI, return HTTP 400 in API, log warning in lenient contexts.
     */
    mode: 'strict' | 'warn' | 'off';
  };
}

/**
 * A definer with preset args type safety.
 * Created via `createDefiner(presetNames).withArgs<ArgsMap>()`.
 */
export interface Definer<TPresetNames extends readonly string[], TArgsMap extends PresetArgsMap> {
  entity<const TStatuses extends readonly string[]>(
    definition: EntityDefinition<TStatuses, TPresetNames, TArgsMap>,
  ): EntityDefinition<TStatuses, TPresetNames, TArgsMap>;
  relation(definition: RelationDefinition): void;
  getRelations(): RelationDefinition[];
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
  relation(definition: RelationDefinition): void;
  getRelations(): RelationDefinition[];
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
  const relations: RelationDefinition[] = [];

  function relation(definition: RelationDefinition): void {
    relations.push(definition);
  }

  function getRelations(): RelationDefinition[] {
    return [...relations];
  }

  return {
    withArgs<TArgsMap extends PresetArgsMap>(): Definer<TPresetNames, TArgsMap> {
      return {
        entity<const TStatuses extends readonly string[]>(
          definition: EntityDefinition<TStatuses, TPresetNames, TArgsMap>,
        ): EntityDefinition<TStatuses, TPresetNames, TArgsMap> {
          return definition;
        },
        relation,
        getRelations,
      };
    },
    entity<const TStatuses extends readonly string[]>(
      definition: EntityDefinition<TStatuses, TPresetNames>,
    ): EntityDefinition<TStatuses, TPresetNames> {
      return definition;
    },
    relation,
    getRelations,
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
 * Thrown when a schema defines two relations with the same name.
 */
export class DuplicateRelationError extends Error {
  constructor(public readonly relationName: string) {
    super(`Duplicate relation name: "${relationName}"`);
    this.name = 'DuplicateRelationError';
  }
}

/**
 * Thrown when a relation references an entity type not defined in the schema.
 */
export class InvalidRelationEntityError extends Error {
  constructor(
    public readonly relationName: string,
    public readonly invalidEntity: string,
    public readonly role: 'source' | 'target',
    public readonly availableEntities: string[],
  ) {
    super(
      `Relation "${relationName}" references invalid ${role} entity type: "${invalidEntity}". ` +
        `Available: ${availableEntities.join(', ')}`,
    );
    this.name = 'InvalidRelationEntityError';
  }
}

/**
 * Extract RelationDefinition[] from a schema, with validation.
 * Returns [] when schema.relations is undefined or empty.
 */
export function extractRelations(
  schema: SchemaDefinition<readonly string[]>,
): RelationDefinition[] {
  if (!schema.relations || schema.relations.length === 0) return [];

  const entityKeys = Object.keys(schema.entities);
  const seen = new Set<string>();

  for (const rel of schema.relations) {
    if (seen.has(rel.name)) {
      throw new DuplicateRelationError(rel.name);
    }
    seen.add(rel.name);

    if (!entityKeys.includes(rel.source)) {
      throw new InvalidRelationEntityError(rel.name, rel.source, 'source', entityKeys);
    }
    if (!entityKeys.includes(rel.target)) {
      throw new InvalidRelationEntityError(rel.name, rel.target, 'target', entityKeys);
    }
  }

  return [...schema.relations];
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

/**
 * Extract machines config from a schema for use with createOrchestrator().
 * Keys are schema record keys (matching Entity.type at runtime).
 */
export function extractMachines(
  schema: SchemaDefinition<readonly string[]>,
): Record<string, { rules: TransitionRule[]; manualTransitions: ManualTransition[] }> {
  const result: Record<
    string,
    { rules: TransitionRule[]; manualTransitions: ManualTransition[] }
  > = {};
  for (const [key, entity] of Object.entries(schema.entities)) {
    result[key] = {
      rules: extractRules(entity),
      manualTransitions: extractManualTransitions(entity),
    };
  }
  return result;
}
