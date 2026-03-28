import { describe, it, expect } from 'vitest';
import { createEngine } from '../../src/engine/engine.js';
import { createOrchestrator } from '../../src/orchestrator/orchestrator.js';
import type { RelationDefinition, RelationInstance } from '../../src/orchestrator/types.js';
import { buildEntityMap, makeEntity, fieldEquals } from './fixtures.js';

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

    const result = orchestrator.simulate(entities, relInstances, {}, {
      entityId: 'exp-001',
      targetStatus: 'RUNNING',
    });

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
    const result = orchestrator.simulate(entities, relInstances, {}, {
      entityId: 'exp-001',
      targetStatus: 'COMPLETED',
    });

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
    const result = orchestrator.simulate(entities, [], {}, {
      entityId: 'exp-001',
      targetStatus: 'COMPLETED',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trace.trigger.from).toBe('DESIGNED');
    expect(result.trace.trigger.to).toBe('COMPLETED');
    expect(result.trace.finalStates.get('exp-001')).toBe('COMPLETED');
  });

  it('entity_not_found error when trigger entity missing', () => {
    const { orchestrator } = setup();
    const entities = buildEntityMap();

    const result = orchestrator.simulate(entities, [], {}, {
      entityId: 'nonexistent',
      targetStatus: 'RUNNING',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('entity_not_found');
    if (result.error === 'entity_not_found') {
      expect(result.entityId).toBe('nonexistent');
    }
  });
});
