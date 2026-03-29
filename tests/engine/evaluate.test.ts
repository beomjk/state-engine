import { describe, it, expect, vi } from 'vitest';
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

  it('UnknownPresetError includes all registered names and presetName', () => {
    const engine = createEngine({
      presets: { alpha: alwaysMet, beta: alwaysMet, gamma: alwaysMet },
    });
    const rule: TransitionRule = {
      from: 'PROPOSED',
      to: 'TESTING',
      conditions: [{ fn: 'missing', args: {} }],
    };

    try {
      engine.evaluate(entity, {}, rule);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(UnknownPresetError);
      const upe = err as InstanceType<typeof UnknownPresetError>;
      expect(upe.presetName).toBe('missing');
      expect(upe.message).toContain('alpha');
      expect(upe.message).toContain('beta');
      expect(upe.message).toContain('gamma');
    }
  });

  it('preset that throws Error propagates through evaluate', () => {
    const throwing: PresetFn<unknown> = () => {
      throw new Error('boom');
    };
    const engine = createEngine({ presets: { throwing } });
    const rule: TransitionRule = {
      from: 'PROPOSED',
      to: 'TESTING',
      conditions: [{ fn: 'throwing', args: {} }],
    };

    expect(() => engine.evaluate(entity, {}, rule)).toThrow('boom');
  });

  it('short-circuits on first failing condition (second preset not called)', () => {
    const second = vi.fn<PresetFn<unknown>>(() => ({ met: true, matchedIds: [] }));
    const engine = createEngine({ presets: { fail: neverMet, second } });
    const rule: TransitionRule = {
      from: 'PROPOSED',
      to: 'TESTING',
      conditions: [
        { fn: 'fail', args: {} },
        { fn: 'second', args: {} },
      ],
    };

    const result = engine.evaluate(entity, {}, rule);

    expect(result.met).toBe(false);
    expect(second).not.toHaveBeenCalled();
  });
});
