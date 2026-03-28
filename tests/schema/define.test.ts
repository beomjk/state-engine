import { describe, it, expect } from 'vitest';
import {
  createDefiner,
  defineEntity,
  defineSchema,
  extractRules,
  extractManualTransitions,
  extractRelations,
  extractMachines,
} from '../../src/schema/define.js';
import type { BuiltinPresetArgsMap } from '../../src/presets/builtins.js';

const define = createDefiner([
  'field_present',
  'field_equals',
] as const).withArgs<BuiltinPresetArgsMap>();

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

  it('extractMachines builds machines config from schema', () => {
    const entityA = define.entity({
      name: 'TypeA',
      statuses: ['IDLE', 'ACTIVE'] as const,
      transitions: [
        { from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'field_present', args: { name: 'x' } }] },
      ],
      manualTransitions: [{ from: 'ACTIVE', to: 'IDLE' }],
    });
    const entityB = define.entity({
      name: 'TypeB',
      statuses: ['OFF', 'ON'] as const,
    });

    const schema = defineSchema({
      presetNames: ['field_present', 'field_equals'] as const,
      entities: { a: entityA, b: entityB },
    });

    const machines = extractMachines(schema);

    expect(Object.keys(machines)).toEqual(['TypeA', 'TypeB']);
    expect(machines['TypeA'].rules).toHaveLength(1);
    expect(machines['TypeA'].rules[0].from).toBe('IDLE');
    expect(machines['TypeA'].rules[0].to).toBe('ACTIVE');
    expect(machines['TypeA'].manualTransitions).toEqual([{ from: 'ACTIVE', to: 'IDLE' }]);
    expect(machines['TypeB'].rules).toEqual([]);
    expect(machines['TypeB'].manualTransitions).toEqual([]);
  });

  it('legacy defineEntity still works (deprecated)', () => {
    const presetNames = ['field_present', 'field_equals'] as const;
    const argsMap = {
      field_present: { name: '' },
      field_equals: { name: '', value: undefined as unknown },
    };
    const def = defineEntity(presetNames, argsMap, {
      name: 'Legacy',
      statuses: ['A'] as const,
    });
    expect(def.name).toBe('Legacy');
  });
});

describe('relation definitions', () => {
  it('define.relation() accumulates definitions', () => {
    const d = createDefiner(['field_present'] as const);
    d.relation({ name: 'tests', source: 'experiment', target: 'hypothesis' });
    d.relation({
      name: 'depends_on',
      source: 'analysis',
      target: 'experiment',
      direction: 'reverse',
    });
    expect(d.getRelations()).toHaveLength(2);
  });

  it('getRelations() returns accumulated array', () => {
    const d = createDefiner(['field_present'] as const);
    d.relation({ name: 'tests', source: 'experiment', target: 'hypothesis' });
    const rels = d.getRelations();
    expect(rels[0].name).toBe('tests');
    expect(rels[0].source).toBe('experiment');
    expect(rels[0].target).toBe('hypothesis');
  });

  it('relation() and getRelations() work on Definer with args', () => {
    const d = createDefiner(['field_present'] as const).withArgs<{
      field_present: { name: string };
    }>();
    d.relation({ name: 'supports', source: 'experiment', target: 'hypothesis' });
    expect(d.getRelations()).toHaveLength(1);
  });

  it('relations shared between DefinerWithoutArgs and Definer via withArgs()', () => {
    const d = createDefiner(['field_present'] as const);
    d.relation({ name: 'first', source: 'a', target: 'b' });
    const withArgs = d.withArgs<{ field_present: { name: string } }>();
    withArgs.relation({ name: 'second', source: 'c', target: 'd' });
    // Both should see all relations
    expect(d.getRelations()).toHaveLength(2);
    expect(withArgs.getRelations()).toHaveLength(2);
  });

  it('direction defaults to undefined (treated as default)', () => {
    const d = createDefiner([] as const);
    d.relation({ name: 'tests', source: 'a', target: 'b' });
    const rel = d.getRelations()[0];
    expect(rel.direction).toBeUndefined();
  });

  it('metadata is opaque and passes through', () => {
    const d = createDefiner([] as const);
    d.relation({
      name: 'supports',
      source: 'a',
      target: 'b',
      metadata: { classification: 'conducts', weight: 0.8 },
    });
    expect(d.getRelations()[0].metadata).toEqual({ classification: 'conducts', weight: 0.8 });
  });

  it('extractRelations() extracts from schema', () => {
    const d = createDefiner(['field_present'] as const);
    const entity = d.entity({ name: 'A', statuses: ['X'] as const });
    const entity2 = d.entity({ name: 'B', statuses: ['Y'] as const });
    d.relation({ name: 'links', source: 'a', target: 'b' });

    const schema = defineSchema({
      presetNames: ['field_present'] as const,
      entities: { a: entity, b: entity2 },
      relations: d.getRelations(),
    });

    const extracted = extractRelations(schema);
    expect(extracted).toHaveLength(1);
    expect(extracted[0].name).toBe('links');
  });

  it('extractRelations() returns empty array when no relations', () => {
    const d = createDefiner([] as const);
    const entity = d.entity({ name: 'A', statuses: ['X'] as const });
    const schema = defineSchema({
      presetNames: [] as const,
      entities: { a: entity },
    });
    expect(extractRelations(schema)).toEqual([]);
  });

  it('extractRelations() throws on duplicate relation name', () => {
    const d = createDefiner([] as const);
    const entity = d.entity({ name: 'A', statuses: ['X'] as const });
    const schema = defineSchema({
      presetNames: [] as const,
      entities: { a: entity },
      relations: [
        { name: 'dup', source: 'a', target: 'a' },
        { name: 'dup', source: 'a', target: 'a' },
      ],
    });
    expect(() => extractRelations(schema)).toThrow(/duplicate.*dup/i);
  });

  it('extractRelations() throws on invalid source entity type', () => {
    const d = createDefiner([] as const);
    const entity = d.entity({ name: 'A', statuses: ['X'] as const });
    const schema = defineSchema({
      presetNames: [] as const,
      entities: { a: entity },
      relations: [{ name: 'bad', source: 'nonexistent', target: 'a' }],
    });
    expect(() => extractRelations(schema)).toThrow(/source.*nonexistent/i);
  });

  it('extractRelations() throws on invalid target entity type', () => {
    const d = createDefiner([] as const);
    const entity = d.entity({ name: 'A', statuses: ['X'] as const });
    const schema = defineSchema({
      presetNames: [] as const,
      entities: { a: entity },
      relations: [{ name: 'bad', source: 'a', target: 'nonexistent' }],
    });
    expect(() => extractRelations(schema)).toThrow(/target.*nonexistent/i);
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
    const narrowDefine = createDefiner(['field_present'] as const).withArgs<{
      field_present: { name: string };
    }>();

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
