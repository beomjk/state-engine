import type { Entity, PresetFn } from '../engine/types.js';

export const builtinPresets = {
  /**
   * Check that entity.meta[name] exists and is non-empty.
   */
  field_present: (entity: Entity, _ctx: unknown, args: { name: string }) => ({
    met:
      entity.meta[args.name] != null &&
      entity.meta[args.name] !== '' &&
      !(Array.isArray(entity.meta[args.name]) && (entity.meta[args.name] as unknown[]).length === 0),
    matchedIds: [],
  }),

  /**
   * Check that entity.meta[name] equals a specific value.
   */
  field_equals: (entity: Entity, _ctx: unknown, args: { name: string; value: unknown }) => ({
    met: entity.meta[args.name] === args.value,
    matchedIds: [],
  }),
} satisfies Record<string, PresetFn<unknown, any>>;
