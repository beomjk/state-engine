import { describe, it, expect } from 'vitest';
import { createEngine } from '../../src/engine/engine.js';
import { createOrchestrator } from '../../src/orchestrator/orchestrator.js';
import type {
  RelationDefinition,
  RelationInstance,
  PropagationStrategy,
  StateChange,
} from '../../src/orchestrator/types.js';
import { buildEntityMap, makeEntity, alwaysMet, returnsIds } from './fixtures.js';

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
      rules: [{ from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] }],
    },
    typeC: {
      rules: [{ from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] }],
    },
  };

  const relations: RelationDefinition[] = [
    {
      name: 'conducts',
      source: 'typeA',
      target: 'typeB',
      metadata: { classification: 'conducts' },
    },
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
      {
        name: 'conducts',
        sourceId: 'a1',
        targetId: 'b1',
        metadata: { classification: 'conducts' },
      },
      { name: 'blocks', sourceId: 'a1', targetId: 'c1', metadata: { classification: 'blocks' } },
    ];

    const result = orchestrator.simulate(
      entities,
      rels,
      {},
      {
        entityId: 'a1',
        targetStatus: 'ACTIVE',
      },
    );

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
      {
        name: 'conducts',
        sourceId: 'a1',
        targetId: 'b1',
        metadata: { classification: 'conducts' },
      },
      { name: 'blocks', sourceId: 'a1', targetId: 'c1', metadata: { classification: 'blocks' } },
    ];

    const result = orchestrator.simulate(
      entities,
      rels,
      {},
      {
        entityId: 'a1',
        targetStatus: 'ACTIVE',
      },
    );

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
      {
        name: 'conducts',
        sourceId: 'a1',
        targetId: 'b1',
        metadata: { classification: 'conducts' },
      },
      { name: 'blocks', sourceId: 'a1', targetId: 'c1', metadata: { classification: 'blocks' } },
    ];

    orchestrator.simulate(
      entities,
      rels,
      {},
      {
        entityId: 'a1',
        targetStatus: 'ACTIVE',
      },
    );

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
      {
        name: 'conducts',
        sourceId: 'a1',
        targetId: 'b1',
        metadata: { classification: 'conducts' },
      },
      { name: 'blocks', sourceId: 'a1', targetId: 'c1', metadata: { classification: 'blocks' } },
    ];

    const result = orchestrator.simulate(
      entities,
      rels,
      {},
      {
        entityId: 'a1',
        targetStatus: 'ACTIVE',
      },
    );

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

    const result = orchestrator.simulate(
      entities,
      rels,
      {},
      {
        entityId: 'a1',
        targetStatus: 'ACTIVE',
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trace.steps).toHaveLength(0);
    expect(result.trace.finalStates.get('b1')).toBe('IDLE');
    expect(result.trace.finalStates.get('c1')).toBe('IDLE');
  });

  it('strategy throwing Error in cascade loop stops with cascade_error', () => {
    // Strategy must throw during cascade (not initial seeding).
    // Use 3-hop: A→B→C. Strategy passes for A→B seeding, throws on B→C inside loop.
    let callCount = 0;
    const throwOnSecond: PropagationStrategy = () => {
      callCount++;
      if (callCount > 1) throw new Error('strategy broke');
      return true;
    };

    const orchestrator = buildOrchestrator({
      machines: {
        ...machines,
        typeC: {
          rules: [{ from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] }],
        },
      },
      relations: [
        ...relations,
        { name: 'b_c', source: 'typeB', target: 'typeC' },
      ],
      propagation: throwOnSecond,
    });

    const entities = buildEntityMap(
      makeEntity('a1', 'typeA', 'IDLE'),
      makeEntity('b1', 'typeB', 'IDLE'),
      makeEntity('c1', 'typeC', 'IDLE'),
    );
    const rels: RelationInstance[] = [
      { name: 'conducts', sourceId: 'a1', targetId: 'b1' },
      { name: 'b_c', sourceId: 'b1', targetId: 'c1' },
    ];

    const result = orchestrator.simulate(entities, rels, {}, {
      entityId: 'a1',
      targetStatus: 'ACTIVE',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('cascade_error');
    if (result.error !== 'cascade_error') return;
    expect(result.partialTrace.error).toBe('strategy broke');
    expect(result.partialTrace.cause).toBeInstanceOf(Error);
    // B should have transitioned before the error
    expect(result.partialTrace.steps).toHaveLength(1);
    expect(result.partialTrace.steps[0].entityId).toBe('b1');
  });

  it('strategy throwing non-Error in cascade loop stops with string fallback', () => {
    let callCount = 0;
    const throwNonError: PropagationStrategy = () => {
      callCount++;
      if (callCount > 1) throw 'raw strategy error';
      return true;
    };

    const orchestrator = buildOrchestrator({
      machines: {
        ...machines,
        typeC: {
          rules: [{ from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] }],
        },
      },
      relations: [
        ...relations,
        { name: 'b_c', source: 'typeB', target: 'typeC' },
      ],
      propagation: throwNonError,
    });

    const entities = buildEntityMap(
      makeEntity('a1', 'typeA', 'IDLE'),
      makeEntity('b1', 'typeB', 'IDLE'),
      makeEntity('c1', 'typeC', 'IDLE'),
    );
    const rels: RelationInstance[] = [
      { name: 'conducts', sourceId: 'a1', targetId: 'b1' },
      { name: 'b_c', sourceId: 'b1', targetId: 'c1' },
    ];

    const result = orchestrator.simulate(entities, rels, {}, {
      entityId: 'a1',
      targetStatus: 'ACTIVE',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('cascade_error');
    if (result.error !== 'cascade_error') return;
    expect(result.partialTrace.error).toBe('raw strategy error');
    expect(result.partialTrace.cause).toBe('raw strategy error');
  });

  it('strategy can filter based on change.from / change.to', () => {
    // Only propagate when source transitions TO 'ACTIVE' (not other statuses)
    const onlyOnActive: PropagationStrategy = (change) => change.to === 'ACTIVE';

    const orchestrator = buildOrchestrator({
      machines,
      relations,
      propagation: onlyOnActive,
    });

    // A -> ACTIVE should propagate (to === 'ACTIVE')
    const entities1 = buildEntityMap(
      makeEntity('a1', 'typeA', 'IDLE'),
      makeEntity('b1', 'typeB', 'IDLE'),
    );
    const rels: RelationInstance[] = [{ name: 'conducts', sourceId: 'a1', targetId: 'b1' }];

    const result1 = orchestrator.simulate(entities1, rels, {}, {
      entityId: 'a1',
      targetStatus: 'ACTIVE',
    });
    expect(result1.ok).toBe(true);
    if (!result1.ok) return;
    expect(result1.trace.steps).toHaveLength(1);
    expect(result1.trace.steps[0].entityId).toBe('b1');

    // A -> PAUSED should NOT propagate (to === 'PAUSED', not 'ACTIVE')
    const pauseMachines = {
      typeA: { rules: [] },
      typeB: {
        rules: [{ from: 'IDLE', to: 'PAUSED', conditions: [{ fn: 'always_met', args: {} }] }],
      },
    };
    const orchestrator2 = buildOrchestrator({
      machines: pauseMachines,
      relations,
      propagation: onlyOnActive,
    });

    const result2 = orchestrator2.simulate(entities1, rels, {}, {
      entityId: 'a1',
      targetStatus: 'PAUSED',
    });
    expect(result2.ok).toBe(true);
    if (!result2.ok) return;
    // Strategy blocks propagation because trigger.to is 'PAUSED'
    expect(result2.trace.steps).toHaveLength(0);
  });

  it('strategy throwing during initial seeding returns cascade_error', () => {
    const throwAlways: PropagationStrategy = () => {
      throw new Error('seeding kaboom');
    };

    const orchestrator = buildOrchestrator({
      machines,
      relations,
      propagation: throwAlways,
    });

    const entities = buildEntityMap(
      makeEntity('a1', 'typeA', 'IDLE'),
      makeEntity('b1', 'typeB', 'IDLE'),
    );
    const rels: RelationInstance[] = [{ name: 'conducts', sourceId: 'a1', targetId: 'b1' }];

    const result = orchestrator.simulate(entities, rels, {}, {
      entityId: 'a1',
      targetStatus: 'ACTIVE',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('cascade_error');
    if (result.error !== 'cascade_error') return;
    expect(result.partialTrace.error).toBe('seeding kaboom');
    expect(result.partialTrace.cause).toBeInstanceOf(Error);
    expect(result.partialTrace.steps).toHaveLength(0);
  });

  it('matchedIds bypass strategy — targets evaluated even when strategy blocks', () => {
    // Strategy allows A→B propagation but blocks B→C
    const blockFromB: PropagationStrategy = (change) => change.entityType !== 'typeB';

    const engine = createEngine<unknown>({
      presets: { always_met: alwaysMet, returns_ids: returnsIds },
    });
    const orchestrator = createOrchestrator<unknown>({
      engine,
      machines: {
        typeA: { rules: [] },
        typeB: {
          rules: [
            { from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'returns_ids', args: { ids: ['c1'] } }] },
          ],
        },
        typeC: {
          rules: [
            { from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] },
          ],
        },
      },
      relations: [
        { name: 'a_b', source: 'typeA', target: 'typeB' },
        { name: 'b_c', source: 'typeB', target: 'typeC' },
      ],
      propagation: blockFromB,
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
    // B transitions via relation (strategy allows A→B)
    expect(result.trace.steps.map((s) => s.entityId)).toContain('b1');
    // C transitions via matchedIds bypass (strategy would block B→C, but matchedIds overrides)
    expect(result.trace.steps.map((s) => s.entityId)).toContain('c1');
    expect(result.trace.finalStates.get('c1')).toBe('ACTIVE');
  });
});
