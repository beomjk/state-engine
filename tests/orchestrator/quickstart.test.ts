/**
 * Validates quickstart.md examples compile and produce expected results.
 */
import { describe, it, expect } from 'vitest';
import {
  createDefiner,
  defineSchema,
  extractRules,
  extractManualTransitions,
  extractRelations,
} from '../../src/schema/define.js';
import { createEngine } from '../../src/engine/engine.js';
import { createOrchestrator } from '../../src/orchestrator/orchestrator.js';
import type { Entity, PresetResult } from '../../src/engine/types.js';
import type { PropagationStrategy, RelationInstance } from '../../src/orchestrator/types.js';

// Minimal preset implementations for quickstart
type Graph = Record<string, unknown>;

interface MyPresetArgsMap {
  has_linked: { type: string; relation: string };
  min_linked_count: { type: string; status: string; min: number };
  field_equals: { field: string; value: unknown };
}

const presetNames = ['has_linked', 'min_linked_count', 'field_equals'] as const;

// Simple preset implementations
const has_linked = (
  _entity: Entity,
  _ctx: Graph,
  _args: Record<string, unknown>,
): PresetResult => ({
  met: true,
  matchedIds: [],
});

const min_linked_count = (
  _entity: Entity,
  _ctx: Graph,
  args: Record<string, unknown>,
): PresetResult => ({
  met: (args.min as number) <= 2,
  matchedIds: [],
});

const field_equals = (
  entity: Entity,
  _ctx: Graph,
  args: Record<string, unknown>,
): PresetResult => ({
  met: entity.meta[args.field as string] === args.value,
  matchedIds: [],
});

describe('quickstart validation', () => {
  it('schema with relations compiles and extracts correctly', () => {
    const define = createDefiner(presetNames).withArgs<MyPresetArgsMap>();

    const hypothesis = define.entity({
      name: 'Hypothesis',
      statuses: ['PROPOSED', 'TESTING', 'SUPPORTED', 'RETRACTED'] as const,
      transitions: [
        {
          from: 'PROPOSED',
          to: 'TESTING',
          conditions: [{ fn: 'has_linked', args: { type: 'experiment', relation: 'tests' } }],
        },
        {
          from: 'TESTING',
          to: 'SUPPORTED',
          conditions: [
            { fn: 'min_linked_count', args: { type: 'experiment', status: 'COMPLETED', min: 2 } },
          ],
        },
      ],
    });

    const experiment = define.entity({
      name: 'Experiment',
      statuses: ['DESIGNED', 'RUNNING', 'COMPLETED', 'FAILED'] as const,
      transitions: [
        {
          from: 'DESIGNED',
          to: 'RUNNING',
          conditions: [{ fn: 'field_equals', args: { field: 'approved', value: true } }],
        },
      ],
      manualTransitions: [
        { from: 'RUNNING', to: 'COMPLETED' },
        { from: 'RUNNING', to: 'FAILED' },
      ],
    });

    define.relation({
      name: 'tests',
      source: 'experiment',
      target: 'hypothesis',
    });

    const schema = defineSchema({
      presetNames,
      entities: { hypothesis, experiment },
      relations: define.getRelations(),
    });

    // Verify extraction
    const hypRules = extractRules(schema.entities.hypothesis);
    expect(hypRules).toHaveLength(2);
    const expManual = extractManualTransitions(schema.entities.experiment);
    expect(expManual).toHaveLength(2);
    const relations = extractRelations(schema);
    expect(relations).toHaveLength(1);
    expect(relations[0].name).toBe('tests');
  });

  it('simulate() returns expected cascade', () => {
    const define = createDefiner(presetNames).withArgs<MyPresetArgsMap>();

    const hypothesis = define.entity({
      name: 'Hypothesis',
      statuses: ['PROPOSED', 'TESTING', 'SUPPORTED', 'RETRACTED'] as const,
      transitions: [
        {
          from: 'TESTING',
          to: 'SUPPORTED',
          conditions: [
            { fn: 'min_linked_count', args: { type: 'experiment', status: 'COMPLETED', min: 2 } },
          ],
        },
      ],
    });

    const experiment = define.entity({
      name: 'Experiment',
      statuses: ['DESIGNED', 'RUNNING', 'COMPLETED', 'FAILED'] as const,
      manualTransitions: [{ from: 'RUNNING', to: 'COMPLETED' }],
    });

    define.relation({ name: 'tests', source: 'experiment', target: 'hypothesis' });

    const schema = defineSchema({
      presetNames,
      entities: { hypothesis, experiment },
      relations: define.getRelations(),
    });

    const engine = createEngine<Graph>({
      presets: { has_linked, min_linked_count, field_equals },
    });

    const orchestrator = createOrchestrator<Graph>({
      engine,
      machines: {
        hypothesis: {
          rules: extractRules(schema.entities.hypothesis),
          manualTransitions: extractManualTransitions(schema.entities.hypothesis),
        },
        experiment: {
          rules: extractRules(schema.entities.experiment),
          manualTransitions: extractManualTransitions(schema.entities.experiment),
        },
      },
      relations: extractRelations(schema),
    });

    const entities = new Map<string, Entity>([
      [
        'exp-001',
        { id: 'exp-001', type: 'experiment', status: 'RUNNING', meta: { approved: true } },
      ],
      [
        'exp-002',
        { id: 'exp-002', type: 'experiment', status: 'COMPLETED', meta: { approved: true } },
      ],
      ['hyp-001', { id: 'hyp-001', type: 'hypothesis', status: 'TESTING', meta: {} }],
    ]);

    const relationInstances: RelationInstance[] = [
      { name: 'tests', sourceId: 'exp-001', targetId: 'hyp-001' },
      { name: 'tests', sourceId: 'exp-002', targetId: 'hyp-001' },
    ];

    const result = orchestrator.simulate(
      entities,
      relationInstances,
      {},
      {
        entityId: 'exp-001',
        targetStatus: 'COMPLETED',
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trace.converged).toBe(true);
    expect(result.trace.trigger.entityId).toBe('exp-001');
    expect(result.trace.trigger.to).toBe('COMPLETED');
    // hypothesis should cascade to SUPPORTED (min_linked_count met: 2 completed)
    expect(result.trace.finalStates.get('hyp-001')).toBe('SUPPORTED');
  });

  it('execute() returns changeset', () => {
    const define = createDefiner(presetNames).withArgs<MyPresetArgsMap>();

    const experiment = define.entity({
      name: 'Experiment',
      statuses: ['RUNNING', 'COMPLETED'] as const,
      manualTransitions: [{ from: 'RUNNING', to: 'COMPLETED' }],
    });

    const schema = defineSchema({
      presetNames,
      entities: { experiment },
    });

    const engine = createEngine<Graph>({
      presets: { has_linked, min_linked_count, field_equals },
    });

    const orchestrator = createOrchestrator<Graph>({
      engine,
      machines: {
        experiment: {
          rules: extractRules(schema.entities.experiment),
          manualTransitions: extractManualTransitions(schema.entities.experiment),
        },
      },
      relations: [],
    });

    const entities = new Map<string, Entity>([
      ['exp-001', { id: 'exp-001', type: 'experiment', status: 'RUNNING', meta: {} }],
    ]);

    const execResult = orchestrator.execute(
      entities,
      [],
      {},
      {
        entityId: 'exp-001',
        targetStatus: 'COMPLETED',
      },
    );

    expect(execResult.ok).toBe(true);
    if (!execResult.ok) return;
    expect(execResult.changeset.changes).toHaveLength(1);
    expect(execResult.changeset.changes[0].to).toBe('COMPLETED');
  });

  it('custom propagation strategy filters correctly', () => {
    const define = createDefiner(presetNames).withArgs<MyPresetArgsMap>();

    const entity = define.entity({
      name: 'Node',
      statuses: ['IDLE', 'ACTIVE'] as const,
      transitions: [
        {
          from: 'IDLE',
          to: 'ACTIVE',
          conditions: [{ fn: 'field_equals', args: { field: 'ready', value: true } }],
        },
      ],
    });

    define.relation({
      name: 'conducts',
      source: 'node',
      target: 'node',
      metadata: { classification: 'conducts' },
    });
    define.relation({
      name: 'blocks',
      source: 'node',
      target: 'node',
      metadata: { classification: 'blocks' },
    });

    const schema = defineSchema({
      presetNames,
      entities: { node: entity },
      relations: define.getRelations(),
    });

    const emddStrategy: PropagationStrategy = (_change, relation) => {
      return relation.metadata?.classification !== 'blocks';
    };

    const engine = createEngine<Graph>({
      presets: { has_linked, min_linked_count, field_equals },
    });

    const orchestrator = createOrchestrator<Graph>({
      engine,
      machines: { node: { rules: extractRules(schema.entities.node) } },
      relations: extractRelations(schema),
      propagation: emddStrategy,
    });

    const entities = new Map<string, Entity>([
      ['n1', { id: 'n1', type: 'node', status: 'IDLE', meta: { ready: true } }],
      ['n2', { id: 'n2', type: 'node', status: 'IDLE', meta: { ready: true } }],
      ['n3', { id: 'n3', type: 'node', status: 'IDLE', meta: { ready: true } }],
    ]);

    const rels: RelationInstance[] = [
      {
        name: 'conducts',
        sourceId: 'n1',
        targetId: 'n2',
        metadata: { classification: 'conducts' },
      },
      { name: 'blocks', sourceId: 'n1', targetId: 'n3', metadata: { classification: 'blocks' } },
    ];

    const result = orchestrator.simulate(
      entities,
      rels,
      {},
      {
        entityId: 'n1',
        targetStatus: 'ACTIVE',
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trace.finalStates.get('n2')).toBe('ACTIVE');
    expect(result.trace.finalStates.get('n3')).toBe('IDLE'); // blocked
  });
});
