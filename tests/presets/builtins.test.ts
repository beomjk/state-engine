import { describe, it, expect } from 'vitest';
import { builtinPresets } from '../../src/presets/builtins.js';
import type { Entity } from '../../src/engine/types.js';

function makeEntity(meta: Record<string, unknown>): Entity {
  return { id: 'e1', type: 'test', status: 'ACTIVE', meta };
}

describe('builtinPresets', () => {
  describe('field_present', () => {
    const fp = builtinPresets.field_present;

    it('met when field exists with truthy value', () => {
      const result = fp(makeEntity({ name: 'Alice' }), {}, { name: 'name' });
      expect(result).toEqual({ met: true, matchedIds: [] });
    });

    it('met when field is 0 (!= null passes for zero)', () => {
      const result = fp(makeEntity({ count: 0 }), {}, { name: 'count' });
      expect(result).toEqual({ met: true, matchedIds: [] });
    });

    it('met when field is false (boolean false is != null)', () => {
      const result = fp(makeEntity({ active: false }), {}, { name: 'active' });
      expect(result).toEqual({ met: true, matchedIds: [] });
    });

    it('met when field is a non-empty array', () => {
      const result = fp(makeEntity({ tags: ['a'] }), {}, { name: 'tags' });
      expect(result).toEqual({ met: true, matchedIds: [] });
    });

    it('not met for null (FR-013)', () => {
      const result = fp(makeEntity({ name: null }), {}, { name: 'name' });
      expect(result.met).toBe(false);
    });

    it('not met for undefined / missing key (FR-013)', () => {
      const result = fp(makeEntity({}), {}, { name: 'missing' });
      expect(result.met).toBe(false);
    });

    it('not met for empty string (FR-013)', () => {
      const result = fp(makeEntity({ name: '' }), {}, { name: 'name' });
      expect(result.met).toBe(false);
    });

    it('not met for empty array (FR-013)', () => {
      const result = fp(makeEntity({ tags: [] }), {}, { name: 'tags' });
      expect(result.met).toBe(false);
    });
  });

  describe('field_equals', () => {
    const fe = builtinPresets.field_equals;

    it('met on strict match (FR-014)', () => {
      const result = fe(makeEntity({ status: 'pass' }), {}, { name: 'status', value: 'pass' });
      expect(result).toEqual({ met: true, matchedIds: [] });
    });

    it('met when comparing numbers', () => {
      const result = fe(makeEntity({ count: 5 }), {}, { name: 'count', value: 5 });
      expect(result).toEqual({ met: true, matchedIds: [] });
    });

    it('not met when value differs', () => {
      const result = fe(makeEntity({ status: 'fail' }), {}, { name: 'status', value: 'pass' });
      expect(result.met).toBe(false);
    });

    it('not met on type mismatch: string "5" !== number 5 (FR-014)', () => {
      const result = fe(makeEntity({ count: '5' }), {}, { name: 'count', value: 5 });
      expect(result.met).toBe(false);
    });

    it('not met when field is missing', () => {
      const result = fe(makeEntity({}), {}, { name: 'missing', value: 'x' });
      expect(result.met).toBe(false);
    });

    it('undefined args.value matches missing field (undefined === undefined)', () => {
      const result = fe(makeEntity({}), {}, { name: 'missing', value: undefined });
      expect(result.met).toBe(true);
    });

    it('null args.value matches null field (null === null)', () => {
      const result = fe(makeEntity({ x: null }), {}, { name: 'x', value: null });
      expect(result.met).toBe(true);
    });

    it('null args.value does NOT match missing field (undefined !== null)', () => {
      const result = fe(makeEntity({}), {}, { name: 'missing', value: null });
      expect(result.met).toBe(false);
    });
  });
});
