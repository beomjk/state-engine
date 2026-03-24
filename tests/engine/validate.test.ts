import { describe, it, expect } from 'vitest';
import { createEngine } from '../../src/engine/engine.js';
import type { Entity, TransitionRule, ManualTransition, PresetFn } from '../../src/engine/types.js';

const alwaysMet: PresetFn<unknown> = (_e, _c, _a) => ({ met: true, matchedIds: ['m1'] });
const neverMet: PresetFn<unknown> = (_e, _c, _a) => ({ met: false, matchedIds: [] });

const entity: Entity = {
  id: 'e1',
  type: 'hypothesis',
  status: 'PROPOSED',
  meta: {},
};

const autoRule: TransitionRule = {
  from: 'PROPOSED',
  to: 'TESTING',
  conditions: [{ fn: 'check', args: {} }],
};

describe('engine.validate', () => {
  it('auto transition success returns { valid: true, rule, matchedIds }', () => {
    const engine = createEngine({ presets: { check: alwaysMet } });

    const result = engine.validate(entity, {}, [autoRule], 'TESTING');

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.rule).toEqual(autoRule);
      expect(result.matchedIds).toEqual(['m1']);
    }
  });

  it('auto transition conditions fail', () => {
    const engine = createEngine({ presets: { check: neverMet } });

    const result = engine.validate(entity, {}, [autoRule], 'TESTING');

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toContain('PROPOSED');
      expect(result.reason).toContain('TESTING');
    }
  });

  it('manual fallback returns { valid: true, rule: null }', () => {
    const engine = createEngine({ presets: { check: neverMet } });
    const manual: ManualTransition[] = [{ from: 'PROPOSED', to: 'TESTING' }];

    const result = engine.validate(entity, {}, [autoRule], 'TESTING', manual);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.rule).toBeNull();
      expect(result.matchedIds).toEqual([]);
    }
  });

  it('ANY wildcard in manual transitions', () => {
    const engine = createEngine({ presets: {} });
    const manual: ManualTransition[] = [{ from: 'ANY', to: 'DEFERRED' }];

    const result = engine.validate(entity, {}, [], 'DEFERRED', manual);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.rule).toBeNull();
    }
  });

  it('no auto or manual match returns { valid: false, reason }', () => {
    const engine = createEngine({ presets: { check: neverMet } });
    const manual: ManualTransition[] = [{ from: 'OTHER', to: 'TESTING' }];

    const result = engine.validate(entity, {}, [autoRule], 'TESTING', manual);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('No valid transition from "PROPOSED" to "TESTING"');
      expect(result.matchedIds).toEqual([]);
    }
  });
});
