import type { Entity, PresetFn } from '../engine/types.js';

export interface FieldPresentArgs {
  /** Name of the meta field to check for presence */
  name: string;
}

export interface FieldEqualsArgs {
  /** Name of the meta field to compare */
  name: string;
  /** Expected value (strict equality via ===) */
  value: unknown;
}

/**
 * Type mapping for built-in presets (FR-016).
 * Consumers extend this with their own domain presets.
 */
export interface BuiltinPresetArgsMap {
  field_present: FieldPresentArgs;
  field_equals: FieldEqualsArgs;
}

export const builtinPresets = {
  /**
   * Check that entity.meta[name] exists and is non-empty.
   */
  field_present: (entity: Entity, _ctx: unknown, args: FieldPresentArgs) => {
    const value = entity.meta[args.name];
    return {
      met: value != null && value !== '' && !(Array.isArray(value) && value.length === 0),
      matchedIds: [],
    };
  },

  /**
   * Check that entity.meta[name] equals a specific value.
   */
  field_equals: (entity: Entity, _ctx: unknown, args: FieldEqualsArgs) => ({
    met: entity.meta[args.name] === args.value,
    matchedIds: [],
  }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- type erasure for heterogeneous preset args
} satisfies Record<string, PresetFn<unknown, any>>;
