import { describe, it, expect } from 'vitest';
import { StateOverlay } from '../../src/orchestrator/overlay.js';
import type { Entity } from '../../src/engine/types.js';
import { makeEntity, buildEntityMap } from './fixtures.js';

describe('StateOverlay', () => {
  const e1 = makeEntity('e1', 'hypothesis', 'PROPOSED');
  const e2 = makeEntity('e2', 'experiment', 'DESIGNED');

  function createOverlay() {
    const base = buildEntityMap(e1, e2);
    return { overlay: new StateOverlay(base), base };
  }

  describe('get()', () => {
    it('returns entity from base map when no override', () => {
      const { overlay } = createOverlay();
      expect(overlay.get('e1')).toEqual(e1);
      expect(overlay.get('e2')).toEqual(e2);
    });

    it('returns undefined for unknown id', () => {
      const { overlay } = createOverlay();
      expect(overlay.get('unknown')).toBeUndefined();
    });

    it('returns override when set', () => {
      const { overlay } = createOverlay();
      const updated: Entity = { ...e1, status: 'TESTING' };
      overlay.set('e1', updated);
      expect(overlay.get('e1')).toEqual(updated);
    });

    it('returns override over base even with same id', () => {
      const { overlay } = createOverlay();
      const updated: Entity = { ...e1, status: 'SUPPORTED' };
      overlay.set('e1', updated);
      // Override takes priority
      expect(overlay.get('e1')!.status).toBe('SUPPORTED');
    });
  });

  describe('set()', () => {
    it('writes only to overlay, base map unchanged', () => {
      const { overlay, base } = createOverlay();
      const updated: Entity = { ...e1, status: 'TESTING' };
      overlay.set('e1', updated);

      // Base map still has original
      expect(base.get('e1')).toEqual(e1);
      // Overlay has updated
      expect(overlay.get('e1')).toEqual(updated);
    });

    it('can add entities not in base', () => {
      const { overlay } = createOverlay();
      const newEntity = makeEntity('e3', 'analysis', 'PENDING');
      overlay.set('e3', newEntity);
      expect(overlay.get('e3')).toEqual(newEntity);
    });
  });

  describe('snapshot()', () => {
    it('returns merged final states as ReadonlyMap<string, string>', () => {
      const { overlay } = createOverlay();
      const snapshot = overlay.snapshot();
      expect(snapshot.get('e1')).toBe('PROPOSED');
      expect(snapshot.get('e2')).toBe('DESIGNED');
    });

    it('reflects overrides in snapshot', () => {
      const { overlay } = createOverlay();
      overlay.set('e1', { ...e1, status: 'TESTING' });
      const snapshot = overlay.snapshot();
      expect(snapshot.get('e1')).toBe('TESTING');
      expect(snapshot.get('e2')).toBe('DESIGNED');
    });

    it('includes entities added via set()', () => {
      const { overlay } = createOverlay();
      overlay.set('e3', makeEntity('e3', 'analysis', 'PENDING'));
      const snapshot = overlay.snapshot();
      expect(snapshot.get('e3')).toBe('PENDING');
      expect(snapshot.size).toBe(3);
    });
  });

  describe('base map immutability', () => {
    it('base map is never modified after multiple operations', () => {
      const base = buildEntityMap(e1, e2);
      const originalE1 = base.get('e1');
      const originalE2 = base.get('e2');
      const overlay = new StateOverlay(base);

      overlay.set('e1', { ...e1, status: 'TESTING' });
      overlay.set('e2', { ...e2, status: 'RUNNING' });
      overlay.set('e3', makeEntity('e3', 'analysis', 'PENDING'));
      overlay.snapshot();

      // Base unchanged
      expect(base.size).toBe(2);
      expect(base.get('e1')).toBe(originalE1);
      expect(base.get('e2')).toBe(originalE2);
      expect(base.has('e3')).toBe(false);
    });
  });
});
