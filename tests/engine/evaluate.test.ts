import { describe, it, expect } from 'vitest';
import { createEngine } from '../../src/engine/engine.js';
import type { Entity, TransitionRule, PresetFn } from '../../src/engine/types.js';
import { UnknownPresetError } from '../../src/engine/types.js';

const alwaysMet: PresetFn<unknown> = (_entity, _ctx, _args) => ({
  met: true,
  matchedIds: [],
});

const neverMet: PresetFn<unknown> = (_entity, _ctx, _args) => ({
  met: false,
  matchedIds: [],
});

const returnsIds =
  (ids: string[]): PresetFn<unknown> =>
  (_entity, _ctx, _args) => ({
    met: true,
    matchedIds: ids,
  });

const entity: Entity = {
  id: 'e1',
  type: 'hypothesis',
  status: 'PROPOSED',
  meta: { assignee: 'Alice' },
};

describe('engine.evaluate', () => {
  it('empty conditions = always passes', () => {
    const engine = createEngine({ presets: {} });
    const rule: TransitionRule = { from: 'PROPOSED', to: 'TESTING', conditions: [] };

    const result = engine.evaluate(entity, {}, rule);

    expect(result).toEqual({ met: true, matchedIds: [] });
  });

  it('single condition met', () => {
    const engine = createEngine({ presets: { check: returnsIds(['id1', 'id2']) } });
    const rule: TransitionRule = {
      from: 'PROPOSED',
      to: 'TESTING',
      conditions: [{ fn: 'check', args: {} }],
    };

    const result = engine.evaluate(entity, {}, rule);

    expect(result).toEqual({ met: true, matchedIds: ['id1', 'id2'] });
  });

  it('single condition not met', () => {
    const engine = createEngine({ presets: { check: neverMet } });
    const rule: TransitionRule = {
      from: 'PROPOSED',
      to: 'TESTING',
      conditions: [{ fn: 'check', args: {} }],
    };

    const result = engine.evaluate(entity, {}, rule);

    expect(result).toEqual({ met: false, matchedIds: [] });
  });

  it('multiple AND conditions all met', () => {
    const engine = createEngine({
      presets: { a: returnsIds(['id1']), b: returnsIds(['id2']) },
    });
    const rule: TransitionRule = {
      from: 'PROPOSED',
      to: 'TESTING',
      conditions: [
        { fn: 'a', args: {} },
        { fn: 'b', args: {} },
      ],
    };

    const result = engine.evaluate(entity, {}, rule);

    expect(result.met).toBe(true);
    expect(result.matchedIds).toEqual(['id1', 'id2']);
  });

  it('multiple AND conditions partial fail', () => {
    const engine = createEngine({
      presets: { a: alwaysMet, b: neverMet },
    });
    const rule: TransitionRule = {
      from: 'PROPOSED',
      to: 'TESTING',
      conditions: [
        { fn: 'a', args: {} },
        { fn: 'b', args: {} },
      ],
    };

    const result = engine.evaluate(entity, {}, rule);

    expect(result).toEqual({ met: false, matchedIds: [] });
  });

  it('matchedIds deduplicated across conditions (FR-018)', () => {
    const engine = createEngine({
      presets: { a: returnsIds(['id1', 'id2']), b: returnsIds(['id2', 'id3']) },
    });
    const rule: TransitionRule = {
      from: 'PROPOSED',
      to: 'TESTING',
      conditions: [
        { fn: 'a', args: {} },
        { fn: 'b', args: {} },
      ],
    };

    const result = engine.evaluate(entity, {}, rule);

    expect(result.met).toBe(true);
    expect(result.matchedIds).toEqual(['id1', 'id2', 'id3']);
  });

  it('unknown preset throws UnknownPresetError', () => {
    const engine = createEngine({ presets: { known: alwaysMet } });
    const rule: TransitionRule = {
      from: 'PROPOSED',
      to: 'TESTING',
      conditions: [{ fn: 'nonexistent', args: {} }],
    };

    expect(() => engine.evaluate(entity, {}, rule)).toThrow(UnknownPresetError);
    expect(() => engine.evaluate(entity, {}, rule)).toThrow(/nonexistent/);
  });
});
