import { describe, it, expect } from 'vitest';
import { createEngine } from '../../src/engine/engine.js';
import { createOrchestrator } from '../../src/orchestrator/orchestrator.js';
import type { RelationDefinition, RelationInstance } from '../../src/orchestrator/types.js';
import { buildEntityMap, makeEntity, fieldEquals, alwaysMet, throwingPreset } from './fixtures.js';

function setup() {
  const engine = createEngine<unknown>({
    presets: { field_equals: fieldEquals },
  });

  const relations: RelationDefinition[] = [
    { name: 'tests', source: 'experiment', target: 'hypothesis' },
  ];

  const orchestrator = createOrchestrator<unknown>({
    engine,
    machines: {
      hypothesis: {
        rules: [
          {
            from: 'PROPOSED',
            to: 'TESTING',
            conditions: [{ fn: 'field_equals', args: { field: 'hasExperiment', value: true } }],
          },
          {
            from: 'TESTING',
            to: 'SUPPORTED',
            conditions: [{ fn: 'field_equals', args: { field: 'allCompleted', value: true } }],
          },
        ],
      },
      experiment: {
        rules: [
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
      },
    },
    relations,
  });

  return { orchestrator, engine };
}

describe('simulate()', () => {
  it('single entity no cascade — only trigger in trace', () => {
    const { orchestrator } = setup();
    const entities = buildEntityMap(
      makeEntity('exp-001', 'experiment', 'DESIGNED', { approved: true }),
    );
    const relInstances: RelationInstance[] = [];

    const result = orchestrator.simulate(
      entities,
      relInstances,
      {},
      {
        entityId: 'exp-001',
        targetStatus: 'RUNNING',
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trace.trigger.entityId).toBe('exp-001');
    expect(result.trace.trigger.from).toBe('DESIGNED');
    expect(result.trace.trigger.to).toBe('RUNNING');
    // No cascade steps (no relations connected)
    expect(result.trace.steps).toHaveLength(0);
    expect(result.trace.converged).toBe(true);
  });

  it('two entities with relation — cascade step appears', () => {
    const { orchestrator } = setup();
    const entities = buildEntityMap(
      makeEntity('exp-001', 'experiment', 'RUNNING', { approved: true }),
      makeEntity('hyp-001', 'hypothesis', 'PROPOSED', { hasExperiment: true }),
    );
    const relInstances: RelationInstance[] = [
      { name: 'tests', sourceId: 'exp-001', targetId: 'hyp-001' },
    ];

    // What-if: exp-001 becomes COMPLETED
    const result = orchestrator.simulate(
      entities,
      relInstances,
      {},
      {
        entityId: 'exp-001',
        targetStatus: 'COMPLETED',
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // hypothesis should be re-evaluated; PROPOSED->TESTING triggers if hasExperiment=true
    expect(result.trace.steps.length).toBeGreaterThanOrEqual(1);
    const hypStep = result.trace.steps.find((s) => s.entityId === 'hyp-001');
    expect(hypStep).toBeDefined();
    expect(hypStep?.from).toBe('PROPOSED');
    expect(hypStep?.to).toBe('TESTING');
    expect(hypStep?.triggeredBy).toContain('exp-001');
  });

  it('what-if forcing invalid status still simulates', () => {
    const { orchestrator } = setup();
    const entities = buildEntityMap(
      makeEntity('exp-001', 'experiment', 'DESIGNED', { approved: false }),
    );

    // Force to COMPLETED even though DESIGNED->COMPLETED is not a valid rule
    const result = orchestrator.simulate(
      entities,
      [],
      {},
      {
        entityId: 'exp-001',
        targetStatus: 'COMPLETED',
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trace.trigger.from).toBe('DESIGNED');
    expect(result.trace.trigger.to).toBe('COMPLETED');
    expect(result.trace.finalStates.get('exp-001')).toBe('COMPLETED');
  });

  it('entity_not_found error when trigger entity missing', () => {
    const { orchestrator } = setup();
    const entities = buildEntityMap();

    const result = orchestrator.simulate(
      entities,
      [],
      {},
      {
        entityId: 'nonexistent',
        targetStatus: 'RUNNING',
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('entity_not_found');
    if (result.error === 'entity_not_found') {
      expect(result.entityId).toBe('nonexistent');
    }
  });

  it('cascade_error when preset throws during cascade', () => {
    const engine = createEngine<unknown>({
      presets: { always_met: alwaysMet, throw_preset: throwingPreset },
    });
    const orchestrator = createOrchestrator<unknown>({
      engine,
      machines: {
        typeA: { rules: [] },
        typeB: {
          rules: [{ from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'throw_preset', args: {} }] }],
        },
      },
      relations: [{ name: 'a_b', source: 'typeA', target: 'typeB' }],
    });

    const entities = buildEntityMap(
      makeEntity('a1', 'typeA', 'IDLE'),
      makeEntity('b1', 'typeB', 'IDLE'),
    );
    const rels: RelationInstance[] = [{ name: 'a_b', sourceId: 'a1', targetId: 'b1' }];

    const result = orchestrator.simulate(entities, rels, {}, {
      entityId: 'a1',
      targetStatus: 'ACTIVE',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('cascade_error');
    if (result.error === 'cascade_error') {
      expect(result.partialTrace).toBeDefined();
      expect(result.partialTrace.error).toBe('Preset evaluation failed');
      expect(result.partialTrace.converged).toBe(false);
    }
  });

  it('multi-hop cascade A -> B -> C via simulate', () => {
    const engine = createEngine<unknown>({
      presets: { always_met: alwaysMet },
    });
    const orchestrator = createOrchestrator<unknown>({
      engine,
      machines: {
        typeA: { rules: [] },
        typeB: {
          rules: [{ from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] }],
        },
        typeC: {
          rules: [{ from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] }],
        },
      },
      relations: [
        { name: 'a_b', source: 'typeA', target: 'typeB' },
        { name: 'b_c', source: 'typeB', target: 'typeC' },
      ],
    });

    const entities = buildEntityMap(
      makeEntity('a1', 'typeA', 'IDLE'),
      makeEntity('b1', 'typeB', 'IDLE'),
      makeEntity('c1', 'typeC', 'IDLE'),
    );
    const rels: RelationInstance[] = [
      { name: 'a_b', sourceId: 'a1', targetId: 'b1' },
      { name: 'b_c', sourceId: 'b1', targetId: 'c1' },
    ];

    const result = orchestrator.simulate(entities, rels, {}, {
      entityId: 'a1',
      targetStatus: 'ACTIVE',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trace.steps).toHaveLength(2);
    expect(result.trace.steps[0].entityId).toBe('b1');
    expect(result.trace.steps[0].to).toBe('ACTIVE');
    expect(result.trace.steps[1].entityId).toBe('c1');
    expect(result.trace.steps[1].to).toBe('ACTIVE');
    expect(result.trace.rounds).toBe(2);
  });

  it('context is passed through to presets during cascade', () => {
    const contextAware = (
      _entity: Parameters<typeof alwaysMet>[0],
      context: { threshold: number },
      args: Record<string, unknown>,
    ) => ({
      met: context.threshold >= (args.min as number),
      matchedIds: [] as string[],
    });

    const engine = createEngine<{ threshold: number }>({
      presets: { context_check: contextAware },
    });
    const orchestrator = createOrchestrator<{ threshold: number }>({
      engine,
      machines: {
        typeA: { rules: [] },
        typeB: {
          rules: [
            { from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'context_check', args: { min: 5 } }] },
          ],
        },
      },
      relations: [{ name: 'a_b', source: 'typeA', target: 'typeB' }],
    });

    const entities = buildEntityMap(
      makeEntity('a1', 'typeA', 'IDLE'),
      makeEntity('b1', 'typeB', 'IDLE'),
    );
    const rels: RelationInstance[] = [{ name: 'a_b', sourceId: 'a1', targetId: 'b1' }];

    // Low threshold — no transition
    const lowResult = orchestrator.simulate(entities, rels, { threshold: 3 }, {
      entityId: 'a1',
      targetStatus: 'ACTIVE',
    });
    expect(lowResult.ok).toBe(true);
    if (!lowResult.ok) return;
    expect(lowResult.trace.steps).toHaveLength(0);

    // High threshold — transition fires
    const highResult = orchestrator.simulate(entities, rels, { threshold: 10 }, {
      entityId: 'a1',
      targetStatus: 'ACTIVE',
    });
    expect(highResult.ok).toBe(true);
    if (!highResult.ok) return;
    expect(highResult.trace.steps).toHaveLength(1);
    expect(highResult.trace.steps[0].entityId).toBe('b1');
    expect(highResult.trace.steps[0].to).toBe('ACTIVE');
  });
});
