import { describe, it, expect } from 'vitest';
import { createDefiner, defineEntity, defineSchema, extractRules, extractManualTransitions } from '../../src/schema/define.js';
import type { BuiltinPresetArgsMap } from '../../src/presets/builtins.js';

const define = createDefiner(['field_present', 'field_equals'] as const)
  .withArgs<BuiltinPresetArgsMap>();

describe('createDefiner / defineSchema', () => {
  it('define.entity returns definition unchanged', () => {
    const def = define.entity({
      name: 'Hypothesis',
      statuses: ['PROPOSED', 'TESTING', 'VALIDATED'] as const,
      transitions: [
        {
          from: 'PROPOSED',
          to: 'TESTING',
          conditions: [{ fn: 'field_present', args: { name: 'assignee' } }],
        },
      ],
      manualTransitions: [{ from: 'ANY', to: 'VALIDATED' }],
    });

    expect(def.name).toBe('Hypothesis');
    expect(def.statuses).toEqual(['PROPOSED', 'TESTING', 'VALIDATED']);
    expect(def.transitions).toHaveLength(1);
    expect(def.manualTransitions).toHaveLength(1);
  });

  it('createDefiner without withArgs still checks statuses and preset names', () => {
    const simpleDefine = createDefiner(['field_present'] as const);
    const def = simpleDefine.entity({
      name: 'Simple',
      statuses: ['A', 'B'] as const,
      transitions: [
        { from: 'A', to: 'B', conditions: [{ fn: 'field_present', args: { name: 'x' } }] },
      ],
    });
    expect(def.name).toBe('Simple');
    expect(def.transitions).toHaveLength(1);
  });

  it('defineSchema returns schema definition', () => {
    const entity = define.entity({
      name: 'Hypothesis',
      statuses: ['PROPOSED', 'TESTING'] as const,
      transitions: [],
    });

    const schema = defineSchema({
      presetNames: ['field_present', 'field_equals'] as const,
      entities: { hypothesis: entity },
    });

    expect(schema.presetNames).toEqual(['field_present', 'field_equals']);
    expect(schema.entities.hypothesis.name).toBe('Hypothesis');
  });

  it('extractRules converts transitions to TransitionRule[]', () => {
    const def = define.entity({
      name: 'Test',
      statuses: ['A', 'B'] as const,
      transitions: [
        {
          from: 'A',
          to: 'B',
          conditions: [{ fn: 'field_present', args: { name: 'x' } }],
        },
      ],
    });

    const rules = extractRules(def);

    expect(rules).toEqual([
      { from: 'A', to: 'B', conditions: [{ fn: 'field_present', args: { name: 'x' } }] },
    ]);
  });

  it('extractRules defaults missing conditions to empty array', () => {
    const def = define.entity({
      name: 'Test',
      statuses: ['A', 'B'] as const,
      transitions: [{ from: 'A', to: 'B' }],
    });

    const rules = extractRules(def);

    expect(rules).toEqual([{ from: 'A', to: 'B', conditions: [] }]);
  });

  it('extractRules returns empty array when no transitions', () => {
    const def = define.entity({
      name: 'Test',
      statuses: ['A'] as const,
    });

    expect(extractRules(def)).toEqual([]);
  });

  it('extractManualTransitions converts manual transitions', () => {
    const def = define.entity({
      name: 'Test',
      statuses: ['A', 'B'] as const,
      manualTransitions: [
        { from: 'A', to: 'B' },
        { from: 'ANY', to: 'A' },
      ],
    });

    const manual = extractManualTransitions(def);

    expect(manual).toEqual([
      { from: 'A', to: 'B' },
      { from: 'ANY', to: 'A' },
    ]);
  });

  it('extractManualTransitions returns empty array when none defined', () => {
    const def = define.entity({
      name: 'Test',
      statuses: ['A'] as const,
    });

    expect(extractManualTransitions(def)).toEqual([]);
  });

  it('legacy defineEntity still works (deprecated)', () => {
    const presetNames = ['field_present', 'field_equals'] as const;
    const argsMap = { field_present: { name: '' }, field_equals: { name: '', value: undefined as unknown } };
    const def = defineEntity(presetNames, argsMap, {
      name: 'Legacy',
      statuses: ['A'] as const,
    });
    expect(def.name).toBe('Legacy');
  });
});

describe('type-level safety', () => {
  it('misspelled status name produces compile error', () => {
    define.entity({
      name: 'Test',
      statuses: ['A', 'B'] as const,
      transitions: [
        {
          // @ts-expect-error — 'INVALID' is not a valid status
          from: 'INVALID',
          to: 'B',
        },
      ],
    });
  });

  it('unregistered preset name produces compile error', () => {
    define.entity({
      name: 'Test',
      statuses: ['A', 'B'] as const,
      transitions: [
        {
          from: 'A',
          to: 'B',
          // @ts-expect-error — 'unknown_preset' is not in presetNames
          conditions: [{ fn: 'unknown_preset', args: { name: 'x' } }],
        },
      ],
    });
  });

  it('incorrect preset args shape produces compile error', () => {
    define.entity({
      name: 'Test',
      statuses: ['A', 'B'] as const,
      transitions: [
        {
          from: 'A',
          to: 'B',
          // @ts-expect-error — field_present requires { name: string }, not { wrong: string }
          conditions: [{ fn: 'field_present', args: { wrong: 'x' } }],
        },
      ],
    });
  });

  it('defineSchema enforces shared preset names across entities', () => {
    const narrowDefine = createDefiner(['field_present'] as const)
      .withArgs<{ field_present: { name: string } }>();

    const entity = narrowDefine.entity({
      name: 'Test',
      statuses: ['A'] as const,
    });

    defineSchema({
      presetNames: ['field_present', 'field_equals'] as const,
      entities: { test: entity },
    });
  });
});
