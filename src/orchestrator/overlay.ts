import type { Entity } from '../engine/types.js';

/**
 * Virtual state overlay for immutable cascade evaluation.
 * Reads return overlay values first, falling back to the base map.
 * Writes go only to the overlay — the base map is never modified.
 */
export class StateOverlay {
  private readonly base: ReadonlyMap<string, Entity>;
  private readonly overrides: Map<string, Entity> = new Map();

  constructor(base: Map<string, Entity>) {
    this.base = new Map(base);
  }

  get(id: string): Entity | undefined {
    return this.overrides.get(id) ?? this.base.get(id);
  }

  set(id: string, entity: Entity): void {
    this.overrides.set(id, entity);
  }

  /**
   * Returns a merged view of entityId -> final status.
   */
  snapshot(): ReadonlyMap<string, string> {
    const result = new Map<string, string>();
    for (const [id, entity] of this.base) {
      result.set(id, entity.status);
    }
    for (const [id, entity] of this.overrides) {
      result.set(id, entity.status);
    }
    return result;
  }
}
