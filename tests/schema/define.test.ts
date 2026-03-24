import { describe, it, expect } from 'vitest';
import { defineEntity, defineSchema, extractRules, extractManualTransitions } from '../../src/schema/define.js';

const presetNames = ['field_present', 'field_equals'] as const;
const argsMap = {
  field_present: { name: '' },
  field_equals: { name: '', value: undefined as unknown },
};

describe('defineEntity / defineSchema', () => {
  it('defineEntity returns definition unchanged', () => {
    const def = defineEntity(presetNames, argsMap, {
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

  it('defineSchema returns schema definition', () => {
    const entity = defineEntity(presetNames, argsMap, {
      name: 'Hypothesis',
      statuses: ['PROPOSED', 'TESTING'] as const,
      transitions: [],
    });

    const schema = defineSchema({
      presetNames,
      entities: { hypothesis: entity },
    });

    expect(schema.presetNames).toEqual(presetNames);
    expect(schema.entities.hypothesis.name).toBe('Hypothesis');
  });

  it('extractRules converts transitions to TransitionRule[]', () => {
    const def = defineEntity(presetNames, argsMap, {
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

  it('extractRules returns empty array when no transitions', () => {
    const def = defineEntity(presetNames, argsMap, {
      name: 'Test',
      statuses: ['A'] as const,
    });

    expect(extractRules(def)).toEqual([]);
  });

  it('extractManualTransitions converts manual transitions', () => {
    const def = defineEntity(presetNames, argsMap, {
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
    const def = defineEntity(presetNames, argsMap, {
      name: 'Test',
      statuses: ['A'] as const,
    });

    expect(extractManualTransitions(def)).toEqual([]);
  });
});

describe('type-level safety', () => {
  it('misspelled status name produces compile error', () => {
    defineEntity(presetNames, argsMap, {
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
    defineEntity(presetNames, argsMap, {
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
    defineEntity(presetNames, argsMap, {
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
    const entity = defineEntity(['field_present'] as const, { field_present: { name: '' } }, {
      name: 'Test',
      statuses: ['A'] as const,
    });

    defineSchema({
      presetNames: ['field_present', 'field_equals'] as const,
      entities: { test: entity },
    });
  });
});
