import { describe, it, expect } from 'vitest';
import { createEngine } from '../../src/engine/engine.js';
import { createOrchestrator } from '../../src/orchestrator/orchestrator.js';
import type {
  RelationDefinition,
  RelationInstance,
  PropagationStrategy,
  StateChange,
} from '../../src/orchestrator/types.js';
import { buildEntityMap, makeEntity, alwaysMet } from './fixtures.js';

function buildOrchestrator(opts: {
  machines: Parameters<typeof createOrchestrator>[0]['machines'];
  relations: RelationDefinition[];
  propagation?: PropagationStrategy;
}) {
  const engine = createEngine<unknown>({
    presets: { always_met: alwaysMet },
  });
  return createOrchestrator<unknown>({
    engine,
    machines: opts.machines,
    relations: opts.relations,
    propagation: opts.propagation,
  });
}

describe('propagation strategy', () => {
  const machines = {
    typeA: { rules: [] },
    typeB: {
      rules: [
        { from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] },
      ],
    },
    typeC: {
      rules: [
        { from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] },
      ],
    },
  };

  const relations: RelationDefinition[] = [
    { name: 'conducts', source: 'typeA', target: 'typeB', metadata: { classification: 'conducts' } },
    { name: 'blocks', source: 'typeA', target: 'typeC', metadata: { classification: 'blocks' } },
  ];

  it('default propagateAll propagates across all relations', () => {
    const orchestrator = buildOrchestrator({ machines, relations });

    const entities = buildEntityMap(
      makeEntity('a1', 'typeA', 'IDLE'),
      makeEntity('b1', 'typeB', 'IDLE'),
      makeEntity('c1', 'typeC', 'IDLE'),
    );
    const rels: RelationInstance[] = [
      { name: 'conducts', sourceId: 'a1', targetId: 'b1', metadata: { classification: 'conducts' } },
      { name: 'blocks', sourceId: 'a1', targetId: 'c1', metadata: { classification: 'blocks' } },
    ];

    const result = orchestrator.simulate(entities, rels, {}, {
      entityId: 'a1',
      targetStatus: 'ACTIVE',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Both b1 and c1 should be affected
    expect(result.trace.steps).toHaveLength(2);
    expect(result.trace.finalStates.get('b1')).toBe('ACTIVE');
    expect(result.trace.finalStates.get('c1')).toBe('ACTIVE');
  });

  it('custom filter blocks relation with classification "blocks"', () => {
    const strategy: PropagationStrategy = (_change, relation) => {
      return relation.metadata?.classification !== 'blocks';
    };

    const orchestrator = buildOrchestrator({ machines, relations, propagation: strategy });

    const entities = buildEntityMap(
      makeEntity('a1', 'typeA', 'IDLE'),
      makeEntity('b1', 'typeB', 'IDLE'),
      makeEntity('c1', 'typeC', 'IDLE'),
    );
    const rels: RelationInstance[] = [
      { name: 'conducts', sourceId: 'a1', targetId: 'b1', metadata: { classification: 'conducts' } },
      { name: 'blocks', sourceId: 'a1', targetId: 'c1', metadata: { classification: 'blocks' } },
    ];

    const result = orchestrator.simulate(entities, rels, {}, {
      entityId: 'a1',
      targetStatus: 'ACTIVE',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Only b1 should cascade (c1 blocked)
    expect(result.trace.steps).toHaveLength(1);
    expect(result.trace.steps[0].entityId).toBe('b1');
    expect(result.trace.finalStates.get('c1')).toBe('IDLE');
  });

  it('strategy receives correct StateChange and RelationInstance', () => {
    const receivedArgs: { change: StateChange; relation: RelationInstance }[] = [];

    const strategy: PropagationStrategy = (change, relation) => {
      receivedArgs.push({ change, relation });
      return true;
    };

    const orchestrator = buildOrchestrator({ machines, relations, propagation: strategy });

    const entities = buildEntityMap(
      makeEntity('a1', 'typeA', 'IDLE'),
      makeEntity('b1', 'typeB', 'IDLE'),
      makeEntity('c1', 'typeC', 'IDLE'),
    );
    const rels: RelationInstance[] = [
      { name: 'conducts', sourceId: 'a1', targetId: 'b1', metadata: { classification: 'conducts' } },
      { name: 'blocks', sourceId: 'a1', targetId: 'c1', metadata: { classification: 'blocks' } },
    ];

    orchestrator.simulate(entities, rels, {}, {
      entityId: 'a1',
      targetStatus: 'ACTIVE',
    });

    // Strategy should have been called for both relation instances
    expect(receivedArgs.length).toBeGreaterThanOrEqual(2);

    // First call should be for the trigger change
    const triggerCalls = receivedArgs.filter(
      (a) => a.change.entityId === 'a1' && a.change.to === 'ACTIVE',
    );
    expect(triggerCalls).toHaveLength(2);

    // Verify relation instances passed correctly
    const relNames = triggerCalls.map((a) => a.relation.name);
    expect(relNames).toContain('conducts');
    expect(relNames).toContain('blocks');
  });

  it('strategy metadata access works', () => {
    const strategy: PropagationStrategy = (_change, relation) => {
      const classification = relation.metadata?.classification as string;
      return classification === 'conducts';
    };

    const orchestrator = buildOrchestrator({ machines, relations, propagation: strategy });

    const entities = buildEntityMap(
      makeEntity('a1', 'typeA', 'IDLE'),
      makeEntity('b1', 'typeB', 'IDLE'),
      makeEntity('c1', 'typeC', 'IDLE'),
    );
    const rels: RelationInstance[] = [
      { name: 'conducts', sourceId: 'a1', targetId: 'b1', metadata: { classification: 'conducts' } },
      { name: 'blocks', sourceId: 'a1', targetId: 'c1', metadata: { classification: 'blocks' } },
    ];

    const result = orchestrator.simulate(entities, rels, {}, {
      entityId: 'a1',
      targetStatus: 'ACTIVE',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trace.steps).toHaveLength(1);
    expect(result.trace.steps[0].entityId).toBe('b1');
  });

  it('strategy returning false for all relations stops all cascade', () => {
    const blockAll: PropagationStrategy = () => false;

    const orchestrator = buildOrchestrator({ machines, relations, propagation: blockAll });

    const entities = buildEntityMap(
      makeEntity('a1', 'typeA', 'IDLE'),
      makeEntity('b1', 'typeB', 'IDLE'),
      makeEntity('c1', 'typeC', 'IDLE'),
    );
    const rels: RelationInstance[] = [
      { name: 'conducts', sourceId: 'a1', targetId: 'b1' },
      { name: 'blocks', sourceId: 'a1', targetId: 'c1' },
    ];

    const result = orchestrator.simulate(entities, rels, {}, {
      entityId: 'a1',
      targetStatus: 'ACTIVE',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trace.steps).toHaveLength(0);
    expect(result.trace.finalStates.get('b1')).toBe('IDLE');
    expect(result.trace.finalStates.get('c1')).toBe('IDLE');
  });
});
