import { describe, it, expect } from 'vitest';
import { createEngine } from '../../src/engine/engine.js';
import type { Entity, ManualTransition, TransitionRule, PresetFn } from '../../src/engine/types.js';

const alwaysMet: PresetFn<unknown> = (_e, _c, _a) => ({ met: true, matchedIds: ['m1'] });
const neverMet: PresetFn<unknown> = (_e, _c, _a) => ({ met: false, matchedIds: [] });

const entity: Entity = {
  id: 'e1',
  type: 'hypothesis',
  status: 'PROPOSED',
  meta: {},
};

describe('engine.getValidTransitions', () => {
  it('returns ValidTransition[] for reachable targets from current status', () => {
    const engine = createEngine({ presets: { check: alwaysMet } });
    const rules: TransitionRule[] = [
      { from: 'PROPOSED', to: 'TESTING', conditions: [{ fn: 'check', args: {} }] },
      { from: 'PROPOSED', to: 'REJECTED', conditions: [{ fn: 'check', args: {} }] },
      { from: 'TESTING', to: 'VALIDATED', conditions: [{ fn: 'check', args: {} }] },
    ];

    const result = engine.getValidTransitions(entity, {}, rules);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      status: 'TESTING',
      rule: rules[0],
      matchedIds: ['m1'],
    });
    expect(result[1]).toEqual({
      status: 'REJECTED',
      rule: rules[1],
      matchedIds: ['m1'],
    });
  });

  it('returns empty array when no rules match current status', () => {
    const engine = createEngine({ presets: { check: alwaysMet } });
    const rules: TransitionRule[] = [
      { from: 'TESTING', to: 'VALIDATED', conditions: [{ fn: 'check', args: {} }] },
    ];

    const result = engine.getValidTransitions(entity, {}, rules);

    expect(result).toEqual([]);
  });

  it('excludes rules where conditions are not met', () => {
    const engine = createEngine({ presets: { pass: alwaysMet, fail: neverMet } });
    const rules: TransitionRule[] = [
      { from: 'PROPOSED', to: 'TESTING', conditions: [{ fn: 'pass', args: {} }] },
      { from: 'PROPOSED', to: 'REJECTED', conditions: [{ fn: 'fail', args: {} }] },
    ];

    const result = engine.getValidTransitions(entity, {}, rules);

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('TESTING');
  });

  it('includes manual transitions when provided', () => {
    const engine = createEngine({ presets: { check: alwaysMet } });
    const rules: TransitionRule[] = [
      { from: 'PROPOSED', to: 'TESTING', conditions: [{ fn: 'check', args: {} }] },
    ];
    const manual: ManualTransition[] = [{ from: 'PROPOSED', to: 'DEFERRED' }];

    const result = engine.getValidTransitions(entity, {}, rules, manual);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      status: 'TESTING',
      rule: rules[0],
      matchedIds: ['m1'],
    });
    expect(result[1]).toEqual({
      status: 'DEFERRED',
      rule: null,
      matchedIds: [],
    });
  });

  it('matches manual transitions with ANY wildcard', () => {
    const engine = createEngine({ presets: {} });
    const manual: ManualTransition[] = [{ from: 'ANY', to: 'ARCHIVED' }];

    const result = engine.getValidTransitions(entity, {}, [], manual);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      status: 'ARCHIVED',
      rule: null,
      matchedIds: [],
    });
  });

  it('excludes manual transitions that do not match current status', () => {
    const engine = createEngine({ presets: {} });
    const manual: ManualTransition[] = [{ from: 'TESTING', to: 'DEFERRED' }];

    const result = engine.getValidTransitions(entity, {}, [], manual);

    expect(result).toEqual([]);
  });

  it('returns only auto transitions when manualTransitions is omitted', () => {
    const engine = createEngine({ presets: { check: alwaysMet } });
    const rules: TransitionRule[] = [
      { from: 'PROPOSED', to: 'TESTING', conditions: [{ fn: 'check', args: {} }] },
    ];

    const result = engine.getValidTransitions(entity, {}, rules);

    expect(result).toHaveLength(1);
    expect(result[0].rule).toEqual(rules[0]);
  });
});
