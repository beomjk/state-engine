import { describe, it, expect } from 'vitest';
import { createEngine } from '../../src/engine/engine.js';
import { createOrchestrator } from '../../src/orchestrator/orchestrator.js';
import type { RelationDefinition, RelationInstance } from '../../src/orchestrator/types.js';
import { propagateAll } from '../../src/orchestrator/types.js';
import {
  buildEntityMap,
  makeEntity,
  fieldEquals,
  alwaysMet,
  throwingPreset,
  throwingNonErrorPreset,
  returnsIds,
  buildChain,
} from './fixtures.js';

/**
 * Helper to build an orchestrator with custom machines and relations.
 */
function buildOrchestrator(opts: {
  machines: Parameters<typeof createOrchestrator>[0]['machines'];
  relations: RelationDefinition[];
  maxCascadeDepth?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  presets?: Record<string, any>;
}) {
  const engine = createEngine<unknown>({
    presets: { field_equals: fieldEquals, always_met: alwaysMet, ...opts.presets },
  });
  return createOrchestrator<unknown>({
    engine,
    machines: opts.machines,
    relations: opts.relations,
    maxCascadeDepth: opts.maxCascadeDepth,
  });
}

describe('cascade behavior', () => {
  it('3-hop chain A -> B -> C', () => {
    // A changes -> B re-evaluates -> C re-evaluates
    const orchestrator = buildOrchestrator({
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
        { name: 'a_to_b', source: 'typeA', target: 'typeB' },
        { name: 'b_to_c', source: 'typeB', target: 'typeC' },
      ],
    });

    const entities = buildEntityMap(
      makeEntity('a1', 'typeA', 'IDLE'),
      makeEntity('b1', 'typeB', 'IDLE'),
      makeEntity('c1', 'typeC', 'IDLE'),
    );
    const rels: RelationInstance[] = [
      { name: 'a_to_b', sourceId: 'a1', targetId: 'b1' },
      { name: 'b_to_c', sourceId: 'b1', targetId: 'c1' },
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
    expect(result.trace.steps).toHaveLength(2);
    expect(result.trace.steps[0].entityId).toBe('b1');
    expect(result.trace.steps[0].to).toBe('ACTIVE');
    expect(result.trace.steps[0].rule).toEqual({ from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] });
    expect(result.trace.steps[1].entityId).toBe('c1');
    expect(result.trace.steps[1].to).toBe('ACTIVE');
    expect(result.trace.steps[1].rule).toEqual({ from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] });
    expect(result.trace.affected).toEqual(['b1', 'c1']);
  });

  it('diamond convergence — A -> B, A -> C, B -> D, C -> D', () => {
    const orchestrator = buildOrchestrator({
      machines: {
        typeA: { rules: [] },
        typeB: {
          rules: [{ from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] }],
        },
        typeC: {
          rules: [{ from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] }],
        },
        typeD: {
          rules: [{ from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] }],
        },
      },
      relations: [
        { name: 'a_b', source: 'typeA', target: 'typeB' },
        { name: 'a_c', source: 'typeA', target: 'typeC' },
        { name: 'b_d', source: 'typeB', target: 'typeD' },
        { name: 'c_d', source: 'typeC', target: 'typeD' },
      ],
    });

    const entities = buildEntityMap(
      makeEntity('a1', 'typeA', 'IDLE'),
      makeEntity('b1', 'typeB', 'IDLE'),
      makeEntity('c1', 'typeC', 'IDLE'),
      makeEntity('d1', 'typeD', 'IDLE'),
    );
    const rels: RelationInstance[] = [
      { name: 'a_b', sourceId: 'a1', targetId: 'b1' },
      { name: 'a_c', sourceId: 'a1', targetId: 'c1' },
      { name: 'b_d', sourceId: 'b1', targetId: 'd1' },
      { name: 'c_d', sourceId: 'c1', targetId: 'd1' },
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
    // B and C should both become ACTIVE, then D should become ACTIVE (exactly 3 steps after BFS dedup)
    expect(result.trace.steps).toHaveLength(3);
    expect(result.trace.finalStates.get('b1')).toBe('ACTIVE');
    expect(result.trace.finalStates.get('c1')).toBe('ACTIVE');
    expect(result.trace.finalStates.get('d1')).toBe('ACTIVE');
    expect(result.trace.converged).toBe(true);
    expect(result.trace.affected).toContain('b1');
    expect(result.trace.affected).toContain('c1');
    expect(result.trace.affected).toContain('d1');
    // D should be triggered by both B and C (merged triggeredBy)
    const dStep = result.trace.steps.find((s) => s.entityId === 'd1');
    expect(dStep).toBeDefined();
    if (!dStep) return;
    expect(dStep.triggeredBy).toContain('b1');
    expect(dStep.triggeredBy).toContain('c1');
    expect(dStep.rule).toEqual({ from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] });
  });

  it('cycle terminates within maxDepth', () => {
    // A -> B -> A (cycle)
    const orchestrator = buildOrchestrator({
      machines: {
        typeA: {
          rules: [
            { from: 'S1', to: 'S2', conditions: [{ fn: 'always_met', args: {} }] },
            { from: 'S2', to: 'S1', conditions: [{ fn: 'always_met', args: {} }] },
          ],
        },
        typeB: {
          rules: [
            { from: 'S1', to: 'S2', conditions: [{ fn: 'always_met', args: {} }] },
            { from: 'S2', to: 'S1', conditions: [{ fn: 'always_met', args: {} }] },
          ],
        },
      },
      relations: [
        { name: 'a_b', source: 'typeA', target: 'typeB' },
        { name: 'b_a', source: 'typeB', target: 'typeA' },
      ],
      maxCascadeDepth: 5,
    });

    const entities = buildEntityMap(
      makeEntity('a1', 'typeA', 'S1'),
      makeEntity('b1', 'typeB', 'S1'),
    );
    const rels: RelationInstance[] = [
      { name: 'a_b', sourceId: 'a1', targetId: 'b1' },
      { name: 'b_a', sourceId: 'b1', targetId: 'a1' },
    ];

    const result = orchestrator.simulate(
      entities,
      rels,
      {},
      {
        entityId: 'a1',
        targetStatus: 'S2',
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Should have terminated, not infinite loop
    expect(result.trace.rounds).toBeLessThanOrEqual(5);
    // Oscillating cascade must report non-convergence
    expect(result.trace.converged).toBe(false);
    expect(result.trace.steps.length).toBeGreaterThan(0);
  });

  it('converged flag is true when cascade reaches fixed point', () => {
    const orchestrator = buildOrchestrator({
      machines: {
        typeA: { rules: [] },
        typeB: {
          rules: [{ from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] }],
        },
      },
      relations: [{ name: 'a_b', source: 'typeA', target: 'typeB' }],
    });

    const entities = buildEntityMap(
      makeEntity('a1', 'typeA', 'IDLE'),
      makeEntity('b1', 'typeB', 'IDLE'),
    );
    const rels: RelationInstance[] = [{ name: 'a_b', sourceId: 'a1', targetId: 'b1' }];

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
    expect(result.trace.converged).toBe(true);
  });

  it('conflict detection — unresolved with conflicting targets', () => {
    // Entity has two valid auto-transitions from same status
    const orchestrator = buildOrchestrator({
      machines: {
        typeA: { rules: [] },
        typeB: {
          rules: [
            { from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] },
            { from: 'IDLE', to: 'PAUSED', conditions: [{ fn: 'always_met', args: {} }] },
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
    expect(result.trace.unresolved).toHaveLength(1);
    expect(result.trace.unresolved[0].entityId).toBe('b1');
    expect(result.trace.unresolved[0].conflictingTargets).toContain('ACTIVE');
    expect(result.trace.unresolved[0].conflictingTargets).toContain('PAUSED');
    expect(result.trace.unresolved[0].round).toBe(1);
    // b1 should NOT appear in steps (not applied)
    expect(result.trace.steps.find((s) => s.entityId === 'b1')).toBeUndefined();
  });

  it('conflict blocks downstream propagation — downstream entity not re-evaluated', () => {
    const orchestrator = buildOrchestrator({
      machines: {
        typeA: { rules: [] },
        typeB: {
          rules: [
            { from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] },
            { from: 'IDLE', to: 'PAUSED', conditions: [{ fn: 'always_met', args: {} }] },
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
    // b1 is unresolved (conflict)
    expect(result.trace.unresolved).toHaveLength(1);
    expect(result.trace.unresolved[0].entityId).toBe('b1');
    // c1 should NOT be re-evaluated (conflict blocks propagation)
    expect(result.trace.steps.find((s) => s.entityId === 'c1')).toBeUndefined();
    expect(result.trace.affected).not.toContain('c1');
    expect(result.trace.finalStates.get('c1')).toBe('IDLE');
  });

  it('manual transition reporting — availableManualTransitions', () => {
    const orchestrator = buildOrchestrator({
      machines: {
        typeA: { rules: [] },
        typeB: {
          rules: [],
          manualTransitions: [{ from: 'IDLE', to: 'ACTIVE' }],
        },
      },
      relations: [{ name: 'a_b', source: 'typeA', target: 'typeB' }],
    });

    const entities = buildEntityMap(
      makeEntity('a1', 'typeA', 'IDLE'),
      makeEntity('b1', 'typeB', 'IDLE'),
    );
    const rels: RelationInstance[] = [{ name: 'a_b', sourceId: 'a1', targetId: 'b1' }];

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
    expect(result.trace.availableManualTransitions).toHaveLength(1);
    expect(result.trace.availableManualTransitions[0]).toEqual({
      entityId: 'b1',
      entityType: 'typeB',
      from: 'IDLE',
      to: 'ACTIVE',
    });
  });

  it('manual transition dedup across re-evaluations in cycle', () => {
    // A <-> B cycle with manual transitions on B.
    // B is re-evaluated across multiple rounds; manual transitions should be reported only once.
    const orchestrator = buildOrchestrator({
      machines: {
        typeA: {
          rules: [
            { from: 'S1', to: 'S2', conditions: [{ fn: 'always_met', args: {} }] },
            { from: 'S2', to: 'S1', conditions: [{ fn: 'always_met', args: {} }] },
          ],
        },
        typeB: {
          rules: [
            { from: 'S1', to: 'S2', conditions: [{ fn: 'always_met', args: {} }] },
            { from: 'S2', to: 'S1', conditions: [{ fn: 'always_met', args: {} }] },
          ],
          manualTransitions: [{ from: 'ANY', to: 'MANUAL_TARGET' }],
        },
      },
      relations: [
        { name: 'a_b', source: 'typeA', target: 'typeB' },
        { name: 'b_a', source: 'typeB', target: 'typeA' },
      ],
      maxCascadeDepth: 4,
    });

    const entities = buildEntityMap(
      makeEntity('a1', 'typeA', 'S1'),
      makeEntity('b1', 'typeB', 'S1'),
    );
    const rels: RelationInstance[] = [
      { name: 'a_b', sourceId: 'a1', targetId: 'b1' },
      { name: 'b_a', sourceId: 'b1', targetId: 'a1' },
    ];

    const result = orchestrator.simulate(entities, rels, {}, {
      entityId: 'a1',
      targetStatus: 'S2',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // B is re-evaluated in multiple rounds, but MANUAL_TARGET should appear only once
    const manualForB = result.trace.availableManualTransitions.filter(
      (mt) => mt.entityId === 'b1' && mt.to === 'MANUAL_TARGET',
    );
    expect(manualForB).toHaveLength(1);
  });

  it('application order correctness — BFS order', () => {
    // A -> B and A -> C, both at round 1
    const orchestrator = buildOrchestrator({
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
        { name: 'a_c', source: 'typeA', target: 'typeC' },
      ],
    });

    const entities = buildEntityMap(
      makeEntity('a1', 'typeA', 'IDLE'),
      makeEntity('b1', 'typeB', 'IDLE'),
      makeEntity('c1', 'typeC', 'IDLE'),
    );
    const rels: RelationInstance[] = [
      { name: 'a_b', sourceId: 'a1', targetId: 'b1' },
      { name: 'a_c', sourceId: 'a1', targetId: 'c1' },
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
    // Both should be round 1 (first cascade wave)
    expect(result.trace.steps).toHaveLength(2);
    expect(result.trace.steps[0].round).toBe(1);
    expect(result.trace.steps[1].round).toBe(1);
  });
});

describe('edge cases', () => {
  it('empty entity map — entity_not_found', () => {
    const orchestrator = buildOrchestrator({
      machines: {},
      relations: [],
    });

    const result = orchestrator.simulate(
      new Map(),
      [],
      {},
      {
        entityId: 'x',
        targetStatus: 'Y',
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('entity_not_found');
  });

  it('entity with no relations — no cascade', () => {
    const orchestrator = buildOrchestrator({
      machines: {
        typeA: { rules: [] },
      },
      relations: [],
    });

    const entities = buildEntityMap(makeEntity('a1', 'typeA', 'IDLE'));

    const result = orchestrator.simulate(
      entities,
      [],
      {},
      {
        entityId: 'a1',
        targetStatus: 'ACTIVE',
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trace.steps).toHaveLength(0);
    expect(result.trace.converged).toBe(true);
  });

  it('maxDepth reached — converged=false, rounds capped', () => {
    const orchestrator = buildOrchestrator({
      machines: {
        typeA: {
          rules: [
            { from: 'S1', to: 'S2', conditions: [{ fn: 'always_met', args: {} }] },
            { from: 'S2', to: 'S1', conditions: [{ fn: 'always_met', args: {} }] },
          ],
        },
        typeB: {
          rules: [
            { from: 'S1', to: 'S2', conditions: [{ fn: 'always_met', args: {} }] },
            { from: 'S2', to: 'S1', conditions: [{ fn: 'always_met', args: {} }] },
          ],
        },
      },
      relations: [
        { name: 'a_b', source: 'typeA', target: 'typeB' },
        { name: 'b_a', source: 'typeB', target: 'typeA' },
      ],
      maxCascadeDepth: 3,
    });

    const entities = buildEntityMap(
      makeEntity('a1', 'typeA', 'S1'),
      makeEntity('b1', 'typeB', 'S1'),
    );
    const rels: RelationInstance[] = [
      { name: 'a_b', sourceId: 'a1', targetId: 'b1' },
      { name: 'b_a', sourceId: 'b1', targetId: 'a1' },
    ];

    const result = orchestrator.simulate(
      entities,
      rels,
      {},
      {
        entityId: 'a1',
        targetStatus: 'S2',
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trace.converged).toBe(false);
    expect(result.trace.rounds).toBe(3);
  });

  it('preset throw — cascade_error with partialTrace', () => {
    const orchestrator = buildOrchestrator({
      machines: {
        typeA: { rules: [] },
        typeB: {
          rules: [{ from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'throw_preset', args: {} }] }],
        },
      },
      relations: [{ name: 'a_b', source: 'typeA', target: 'typeB' }],
      presets: {
        throw_preset: throwingPreset,
      },
    });

    const entities = buildEntityMap(
      makeEntity('a1', 'typeA', 'IDLE'),
      makeEntity('b1', 'typeB', 'IDLE'),
    );
    const rels: RelationInstance[] = [{ name: 'a_b', sourceId: 'a1', targetId: 'b1' }];

    const result = orchestrator.simulate(
      entities,
      rels,
      {},
      {
        entityId: 'a1',
        targetStatus: 'ACTIVE',
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('cascade_error');
    if (result.error === 'cascade_error') {
      expect(result.partialTrace).toBeDefined();
      expect(result.partialTrace.trigger.entityId).toBe('a1');
      // cause preserves the original Error instance
      expect(result.partialTrace.cause).toBeInstanceOf(Error);
      expect((result.partialTrace.cause as Error).message).toBe('Preset evaluation failed');
    }
  });

  it('non-Error throw — cascade_error with String(err) fallback', () => {
    const orchestrator = buildOrchestrator({
      machines: {
        typeA: { rules: [] },
        typeB: {
          rules: [
            { from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'throw_non_error', args: {} }] },
          ],
        },
      },
      relations: [{ name: 'a_b', source: 'typeA', target: 'typeB' }],
      presets: {
        throw_non_error: throwingNonErrorPreset,
      },
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
      expect(result.partialTrace.error).toBe('raw string error');
      expect(result.partialTrace.converged).toBe(false);
      // cause preserves the raw thrown value
      expect(result.partialTrace.cause).toBe('raw string error');
    }
  });

  it('missing entity in relation — skip gracefully', () => {
    const orchestrator = buildOrchestrator({
      machines: {
        typeA: { rules: [] },
        typeB: {
          rules: [{ from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] }],
        },
      },
      relations: [{ name: 'a_b', source: 'typeA', target: 'typeB' }],
    });

    const entities = buildEntityMap(
      makeEntity('a1', 'typeA', 'IDLE'),
      // b1 is referenced in relation but NOT in entity map
    );
    const rels: RelationInstance[] = [{ name: 'a_b', sourceId: 'a1', targetId: 'nonexistent' }];

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
    // Should complete without error, just skip the missing entity
    expect(result.trace.converged).toBe(true);
  });

  it('error at mid-cascade preserves partial progress in partialTrace', () => {
    // Chain A → B → C; B transitions fine, C throws
    const orchestrator = buildOrchestrator({
      machines: {
        typeA: { rules: [] },
        typeB: {
          rules: [{ from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] }],
        },
        typeC: {
          rules: [
            { from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'throw_preset', args: {} }] },
          ],
        },
      },
      relations: [
        { name: 'a_b', source: 'typeA', target: 'typeB' },
        { name: 'b_c', source: 'typeB', target: 'typeC' },
      ],
      presets: { throw_preset: throwingPreset },
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

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('cascade_error');
    if (result.error !== 'cascade_error') return;
    // B should have transitioned before C threw
    expect(result.partialTrace.steps).toHaveLength(1);
    expect(result.partialTrace.steps[0].entityId).toBe('b1');
    expect(result.partialTrace.steps[0].to).toBe('ACTIVE');
    expect(result.partialTrace.error).toBe('Preset evaluation failed');
  });
});

describe('matchedIds instance targeting', () => {
  it('preset returns specific matchedIds — only those entities re-evaluated downstream', () => {
    // A triggers → B evaluated with returns_ids=['c1'] → only c1 re-evaluated (not c2)
    const orchestrator = buildOrchestrator({
      machines: {
        typeA: { rules: [] },
        typeB: {
          rules: [
            {
              from: 'IDLE',
              to: 'ACTIVE',
              conditions: [{ fn: 'returns_ids', args: { ids: ['c1'] } }],
            },
          ],
        },
        typeC: {
          rules: [{ from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] }],
        },
      },
      relations: [
        { name: 'a_b', source: 'typeA', target: 'typeB' },
        { name: 'b_c', source: 'typeB', target: 'typeC' },
      ],
      presets: { returns_ids: returnsIds },
    });

    const entities = buildEntityMap(
      makeEntity('a1', 'typeA', 'IDLE'),
      makeEntity('b1', 'typeB', 'IDLE'),
      makeEntity('c1', 'typeC', 'IDLE'),
      makeEntity('c2', 'typeC', 'IDLE'),
    );
    const rels: RelationInstance[] = [
      { name: 'a_b', sourceId: 'a1', targetId: 'b1' },
      { name: 'b_c', sourceId: 'b1', targetId: 'c1' },
      { name: 'b_c', sourceId: 'b1', targetId: 'c2' },
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
    // b1 transitions (matchedIds=['c1']), so only c1 should be re-evaluated
    const steppedIds = result.trace.steps.map((s) => s.entityId);
    expect(steppedIds).toContain('b1');
    expect(steppedIds).toContain('c1');
    expect(steppedIds).not.toContain('c2');
    expect(result.trace.finalStates.get('c1')).toBe('ACTIVE');
    expect(result.trace.finalStates.get('c2')).toBe('IDLE');
  });

  it('empty matchedIds falls back to relation-based propagation', () => {
    // B's rule returns matchedIds=[] → fall back to all relation instances for downstream
    const orchestrator = buildOrchestrator({
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
      makeEntity('c2', 'typeC', 'IDLE'),
    );
    const rels: RelationInstance[] = [
      { name: 'a_b', sourceId: 'a1', targetId: 'b1' },
      { name: 'b_c', sourceId: 'b1', targetId: 'c1' },
      { name: 'b_c', sourceId: 'b1', targetId: 'c2' },
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
    // Both c1 and c2 should be re-evaluated (relation-based fallback)
    expect(result.trace.steps).toHaveLength(3); // b1 + c1 + c2
    expect(result.trace.finalStates.get('c1')).toBe('ACTIVE');
    expect(result.trace.finalStates.get('c2')).toBe('ACTIVE');
  });

  it('matchedIds pointing to entity not in entity map — skip gracefully', () => {
    const orchestrator = buildOrchestrator({
      machines: {
        typeA: { rules: [] },
        typeB: {
          rules: [
            {
              from: 'IDLE',
              to: 'ACTIVE',
              conditions: [{ fn: 'returns_ids', args: { ids: ['nonexistent'] } }],
            },
          ],
        },
      },
      relations: [{ name: 'a_b', source: 'typeA', target: 'typeB' }],
      presets: { returns_ids: returnsIds },
    });

    const entities = buildEntityMap(
      makeEntity('a1', 'typeA', 'IDLE'),
      makeEntity('b1', 'typeB', 'IDLE'),
    );
    const rels: RelationInstance[] = [{ name: 'a_b', sourceId: 'a1', targetId: 'b1' }];

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
    // b1 transitions with matchedIds=['nonexistent'] — nonexistent is enqueued but skipped
    expect(result.trace.steps).toHaveLength(1); // only b1
    expect(result.trace.converged).toBe(true);
  });
});

describe('reverse direction relations', () => {
  it('reverse relation: target changes -> source re-evaluated', () => {
    const orchestrator = buildOrchestrator({
      machines: {
        typeA: {
          rules: [{ from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] }],
        },
        typeB: { rules: [] },
      },
      relations: [{ name: 'depends_on', source: 'typeA', target: 'typeB', direction: 'reverse' }],
    });

    const entities = buildEntityMap(
      makeEntity('a1', 'typeA', 'IDLE'),
      makeEntity('b1', 'typeB', 'IDLE'),
    );
    const rels: RelationInstance[] = [{ name: 'depends_on', sourceId: 'a1', targetId: 'b1' }];

    // Trigger: b1 changes (typeB) -> should re-evaluate a1 (source, via reverse)
    const result = orchestrator.simulate(
      entities,
      rels,
      {},
      {
        entityId: 'b1',
        targetStatus: 'ACTIVE',
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trace.steps).toHaveLength(1);
    expect(result.trace.steps[0].entityId).toBe('a1');
    expect(result.trace.steps[0].to).toBe('ACTIVE');
  });

  it('reverse relation does not propagate in default direction', () => {
    const orchestrator = buildOrchestrator({
      machines: {
        typeA: { rules: [] },
        typeB: {
          rules: [{ from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] }],
        },
      },
      relations: [{ name: 'depends_on', source: 'typeA', target: 'typeB', direction: 'reverse' }],
    });

    const entities = buildEntityMap(
      makeEntity('a1', 'typeA', 'IDLE'),
      makeEntity('b1', 'typeB', 'IDLE'),
    );
    const rels: RelationInstance[] = [{ name: 'depends_on', sourceId: 'a1', targetId: 'b1' }];

    // Trigger: a1 changes (typeA) -> reverse relation should NOT trigger b1
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
  });
});

describe('additional edge cases', () => {
  it('auto-transition dedup — two rules same target, only one step produced', () => {
    const orchestrator = buildOrchestrator({
      machines: {
        typeA: { rules: [] },
        typeB: {
          rules: [
            { from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] },
            { from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] },
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
    expect(result.trace.steps[0].to).toBe('ACTIVE');
  });

  it('auto-transition dedup merges matchedIds from multiple rules', () => {
    const orchestrator = buildOrchestrator({
      machines: {
        typeA: { rules: [] },
        typeB: {
          rules: [
            { from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'returns_ids', args: { ids: ['c1'] } }] },
            { from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'returns_ids', args: { ids: ['c2'] } }] },
          ],
        },
        typeC: {
          rules: [
            { from: 'IDLE', to: 'DONE', conditions: [{ fn: 'always_met', args: {} }] },
          ],
        },
      },
      presets: { returns_ids: returnsIds },
      relations: [{ name: 'a_b', source: 'typeA', target: 'typeB' }],
    });

    const entities = buildEntityMap(
      makeEntity('a1', 'typeA', 'IDLE'),
      makeEntity('b1', 'typeB', 'IDLE'),
      makeEntity('c1', 'typeC', 'IDLE'),
      makeEntity('c2', 'typeC', 'IDLE'),
    );
    const rels: RelationInstance[] = [{ name: 'a_b', sourceId: 'a1', targetId: 'b1' }];

    const result = orchestrator.simulate(entities, rels, {}, {
      entityId: 'a1',
      targetStatus: 'ACTIVE',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // b1 transitions via deduped rule
    expect(result.trace.steps[0].entityId).toBe('b1');
    // Both c1 and c2 should be targeted (merged matchedIds)
    const cSteps = result.trace.steps.filter((s) => s.entityType === 'typeC');
    expect(cSteps).toHaveLength(2);
    const cIds = cSteps.map((s) => s.entityId).sort();
    expect(cIds).toEqual(['c1', 'c2']);
  });

  it('missing machine for cascaded entity — skip gracefully', () => {
    const orchestrator = buildOrchestrator({
      machines: {
        typeA: { rules: [] },
        // No machine for typeB
      },
      relations: [{ name: 'a_b', source: 'typeA', target: 'typeB' }],
    });

    const entities = buildEntityMap(
      makeEntity('a1', 'typeA', 'IDLE'),
      makeEntity('b1', 'typeB', 'IDLE'),
    );
    const rels: RelationInstance[] = [{ name: 'a_b', sourceId: 'a1', targetId: 'b1' }];

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
    expect(result.trace.converged).toBe(true);
  });

  it('context is passed through to engine during cascade evaluation', () => {
    // Preset that reads from context to decide transition
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

    // Context threshold too low — b1 should NOT transition
    const lowResult = orchestrator.simulate(entities, rels, { threshold: 3 }, {
      entityId: 'a1',
      targetStatus: 'ACTIVE',
    });
    expect(lowResult.ok).toBe(true);
    if (!lowResult.ok) return;
    expect(lowResult.trace.steps).toHaveLength(0);

    // Context threshold met — b1 should transition
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

  it('maxCascadeDepth=1 — only immediate downstream evaluated', () => {
    // A -> B -> C chain, but depth=1 means only B (round 1) should fire; C (round 2) is blocked
    const orchestrator = buildOrchestrator({
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
        { name: 'a_to_b', source: 'typeA', target: 'typeB' },
        { name: 'b_to_c', source: 'typeB', target: 'typeC' },
      ],
      maxCascadeDepth: 1,
    });

    const entities = buildEntityMap(
      makeEntity('a1', 'typeA', 'IDLE'),
      makeEntity('b1', 'typeB', 'IDLE'),
      makeEntity('c1', 'typeC', 'IDLE'),
    );
    const rels: RelationInstance[] = [
      { name: 'a_to_b', sourceId: 'a1', targetId: 'b1' },
      { name: 'b_to_c', sourceId: 'b1', targetId: 'c1' },
    ];

    const result = orchestrator.simulate(entities, rels, {}, {
      entityId: 'a1',
      targetStatus: 'ACTIVE',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Only B transitions (round 1); C is blocked because round 2 > maxDepth 1
    expect(result.trace.steps).toHaveLength(1);
    expect(result.trace.steps[0].entityId).toBe('b1');
    expect(result.trace.steps[0].to).toBe('ACTIVE');
    expect(result.trace.steps[0].round).toBe(1);
    expect(result.trace.converged).toBe(false);
    expect(result.trace.finalStates.get('c1')).toBe('IDLE');
  });

  it('many-to-one fan-in — multiple sources trigger same target in same round', () => {
    // Parent P -> A1 + A2 (both typeA), both A1 and A2 -> B1 (typeB)
    // P triggers cascade: A1 and A2 both transition in round 1, B1 in round 2
    const orchestrator = buildOrchestrator({
      machines: {
        typeP: { rules: [] },
        typeA: {
          rules: [{ from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] }],
        },
        typeB: {
          rules: [{ from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] }],
        },
      },
      relations: [
        { name: 'p_to_a', source: 'typeP', target: 'typeA' },
        { name: 'a_to_b', source: 'typeA', target: 'typeB' },
      ],
    });

    const entities = buildEntityMap(
      makeEntity('p1', 'typeP', 'IDLE'),
      makeEntity('a1', 'typeA', 'IDLE'),
      makeEntity('a2', 'typeA', 'IDLE'),
      makeEntity('b1', 'typeB', 'IDLE'),
    );
    const rels: RelationInstance[] = [
      { name: 'p_to_a', sourceId: 'p1', targetId: 'a1' },
      { name: 'p_to_a', sourceId: 'p1', targetId: 'a2' },
      { name: 'a_to_b', sourceId: 'a1', targetId: 'b1' },
      { name: 'a_to_b', sourceId: 'a2', targetId: 'b1' },
    ];

    const result = orchestrator.simulate(entities, rels, {}, {
      entityId: 'p1',
      targetStatus: 'ACTIVE',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A1 and A2 in round 1, B1 in round 2 (deduped — only evaluated once)
    expect(result.trace.steps).toHaveLength(3);
    const bStep = result.trace.steps.find((s) => s.entityId === 'b1');
    expect(bStep).toBeDefined();
    if (!bStep) return;
    expect(bStep.round).toBe(2);
    expect(bStep.to).toBe('ACTIVE');
    // B1 should have both A1 and A2 in triggeredBy (merged via BFS dedup)
    expect(bStep.triggeredBy).toContain('a1');
    expect(bStep.triggeredBy).toContain('a2');
    expect(bStep.triggeredBy).toHaveLength(2);
    expect(result.trace.converged).toBe(true);
  });
});

describe('contextEnricher', () => {
  /**
   * Scenario: two experiments linked to a hypothesis.
   * Hypothesis transitions only when 2+ linked experiments are COMPLETED.
   * Without contextEnricher, the preset can't see cascade-applied status changes.
   * With contextEnricher, the preset reads live overlay state via getStatus().
   */
  function buildEnricherScenario(useEnricher: boolean) {
    // Preset: count how many linked experiment IDs are COMPLETED
    const countCompleted = (
      _entity: Parameters<typeof alwaysMet>[0],
      context: { completedCount: number },
      args: Record<string, unknown>,
    ) => ({
      met: context.completedCount >= (args.min as number),
      matchedIds: [] as string[],
    });

    const engine = createEngine<{ completedCount: number }>({
      presets: { always_met: alwaysMet, count_completed: countCompleted },
    });

    const enricher = useEnricher
      ? (
          _base: { completedCount: number },
          getStatus: (id: string) => string | undefined,
        ) => ({
          completedCount: ['exp1', 'exp2'].filter(
            (id) => getStatus(id) === 'COMPLETED',
          ).length,
        })
      : undefined;

    const orchestrator = createOrchestrator<{ completedCount: number }>({
      engine,
      machines: {
        experiment: {
          rules: [
            { from: 'IDLE', to: 'COMPLETED', conditions: [{ fn: 'always_met', args: {} }] },
          ],
        },
        hypothesis: {
          rules: [
            {
              from: 'PROPOSED',
              to: 'SUPPORTED',
              conditions: [{ fn: 'count_completed', args: { min: 2 } }],
            },
          ],
        },
      },
      relations: [
        { name: 'tests', source: 'experiment', target: 'hypothesis' },
      ],
      contextEnricher: enricher,
    });

    // exp1 already COMPLETED, exp2 still IDLE
    const entities = buildEntityMap(
      makeEntity('exp1', 'experiment', 'COMPLETED'),
      makeEntity('exp2', 'experiment', 'IDLE'),
      makeEntity('hyp1', 'hypothesis', 'PROPOSED'),
    );
    const rels: RelationInstance[] = [
      { name: 'tests', sourceId: 'exp1', targetId: 'hyp1' },
      { name: 'tests', sourceId: 'exp2', targetId: 'hyp1' },
    ];

    return { orchestrator, entities, rels };
  }

  it('enricher provides live overlay state — hypothesis transitions when 2 experiments COMPLETED', () => {
    const { orchestrator, entities, rels } = buildEnricherScenario(true);

    // Trigger: exp2 → COMPLETED (now both experiments are COMPLETED)
    const result = orchestrator.simulate(
      entities,
      rels,
      { completedCount: 0 },
      { entityId: 'exp2', targetStatus: 'COMPLETED' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Hypothesis should transition because enricher sees both experiments COMPLETED
    const hypStep = result.trace.steps.find((s) => s.entityId === 'hyp1');
    expect(hypStep).toBeDefined();
    expect(hypStep?.to).toBe('SUPPORTED');
  });

  it('without enricher — hypothesis does NOT transition (stale context)', () => {
    const { orchestrator, entities, rels } = buildEnricherScenario(false);

    // Same trigger, but no enricher — context.completedCount stays 0
    const result = orchestrator.simulate(
      entities,
      rels,
      { completedCount: 0 },
      { entityId: 'exp2', targetStatus: 'COMPLETED' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Hypothesis should NOT transition (context.completedCount is still 0)
    const hypStep = result.trace.steps.find((s) => s.entityId === 'hyp1');
    expect(hypStep).toBeUndefined();
  });

  it('getStatus returns undefined for nonexistent entity', () => {
    let capturedUndefined: string | undefined = 'not-called';

    const engine = createEngine<{ flag: boolean }>({
      presets: { always_met: alwaysMet },
    });
    const orchestrator = createOrchestrator<{ flag: boolean }>({
      engine,
      machines: {
        typeA: { rules: [] },
        typeB: {
          rules: [{ from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] }],
        },
      },
      relations: [{ name: 'a_b', source: 'typeA', target: 'typeB' }],
      contextEnricher: (base, getStatus) => {
        capturedUndefined = getStatus('nonexistent');
        return base;
      },
    });

    const entities = buildEntityMap(
      makeEntity('a1', 'typeA', 'IDLE'),
      makeEntity('b1', 'typeB', 'IDLE'),
    );
    const rels: RelationInstance[] = [{ name: 'a_b', sourceId: 'a1', targetId: 'b1' }];

    orchestrator.simulate(entities, rels, { flag: true }, {
      entityId: 'a1',
      targetStatus: 'ACTIVE',
    });

    expect(capturedUndefined).toBeUndefined();
  });

  it('enricher is called once per entity evaluation in cascade', () => {
    let callCount = 0;

    const engine = createEngine<Record<string, never>>({
      presets: { always_met: alwaysMet },
    });
    const orchestrator = createOrchestrator<Record<string, never>>({
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
      contextEnricher: (base, _getStatus) => {
        callCount++;
        return base;
      },
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

    orchestrator.simulate(entities, rels, {} as Record<string, never>, {
      entityId: 'a1',
      targetStatus: 'ACTIVE',
    });

    // b1 evaluated in round 1, c1 in round 2 = 2 calls
    expect(callCount).toBe(2);
  });

  it('enricher throw — cascade_error with partialTrace', () => {
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
      },
      relations: [{ name: 'a_b', source: 'typeA', target: 'typeB' }],
      contextEnricher: () => {
        throw new Error('Enricher failed');
      },
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
    if (result.error !== 'cascade_error') return;
    expect(result.partialTrace.converged).toBe(false);
    expect(result.partialTrace.error).toBe('Enricher failed');
    expect(result.partialTrace.cause).toBeInstanceOf(Error);
    expect((result.partialTrace.cause as Error).message).toBe('Enricher failed');
  });
});

describe('defensive guards', () => {
  it('all auto-filtered transitions have non-null rule (invariant)', () => {
    const orchestrator = buildOrchestrator({
      machines: {
        typeA: { rules: [] },
        typeB: {
          rules: [
            { from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] },
            { from: 'ACTIVE', to: 'DONE', conditions: [{ fn: 'always_met', args: {} }] },
          ],
          manualTransitions: [{ from: 'IDLE', to: 'DONE' }],
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
    for (const step of result.trace.steps) {
      expect(step.rule).not.toBeNull();
      expect(step.rule).toHaveProperty('from');
      expect(step.rule).toHaveProperty('to');
    }
  });
});

describe('self-referential relations', () => {
  it('entity type relates to itself — chain within same type', () => {
    const orchestrator = buildOrchestrator({
      machines: {
        node: {
          rules: [{ from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] }],
        },
      },
      relations: [{ name: 'parent_child', source: 'node', target: 'node' }],
    });

    const entities = buildEntityMap(
      makeEntity('n1', 'node', 'IDLE'),
      makeEntity('n2', 'node', 'IDLE'),
    );
    const rels: RelationInstance[] = [
      { name: 'parent_child', sourceId: 'n1', targetId: 'n2' },
    ];

    const result = orchestrator.simulate(entities, rels, {}, {
      entityId: 'n1',
      targetStatus: 'ACTIVE',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trace.steps).toHaveLength(1);
    expect(result.trace.steps[0].entityId).toBe('n2');
    expect(result.trace.finalStates.get('n2')).toBe('ACTIVE');
  });

  it('self-relation multi-hop: n1 → n2 → n3 cascading correctly', () => {
    const orchestrator = buildOrchestrator({
      machines: {
        node: {
          rules: [{ from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] }],
        },
      },
      relations: [{ name: 'parent_child', source: 'node', target: 'node' }],
    });

    const entities = buildEntityMap(
      makeEntity('n1', 'node', 'IDLE'),
      makeEntity('n2', 'node', 'IDLE'),
      makeEntity('n3', 'node', 'IDLE'),
    );
    const rels: RelationInstance[] = [
      { name: 'parent_child', sourceId: 'n1', targetId: 'n2' },
      { name: 'parent_child', sourceId: 'n2', targetId: 'n3' },
    ];

    const result = orchestrator.simulate(entities, rels, {}, {
      entityId: 'n1',
      targetStatus: 'ACTIVE',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trace.steps).toHaveLength(2);
    expect(result.trace.steps[0].entityId).toBe('n2');
    expect(result.trace.steps[1].entityId).toBe('n3');
    expect(result.trace.rounds).toBe(2);
  });
});

describe('diamond fan-in with conflict', () => {
  it('diamond convergence where target has conflicting rules', () => {
    const orchestrator = buildOrchestrator({
      machines: {
        typeA: { rules: [] },
        typeB: {
          rules: [{ from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] }],
        },
        typeC: {
          rules: [{ from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] }],
        },
        typeD: {
          rules: [
            { from: 'IDLE', to: 'X', conditions: [{ fn: 'always_met', args: {} }] },
            { from: 'IDLE', to: 'Y', conditions: [{ fn: 'always_met', args: {} }] },
          ],
        },
      },
      relations: [
        { name: 'a_b', source: 'typeA', target: 'typeB' },
        { name: 'a_c', source: 'typeA', target: 'typeC' },
        { name: 'b_d', source: 'typeB', target: 'typeD' },
        { name: 'c_d', source: 'typeC', target: 'typeD' },
      ],
    });

    const entities = buildEntityMap(
      makeEntity('a1', 'typeA', 'IDLE'),
      makeEntity('b1', 'typeB', 'IDLE'),
      makeEntity('c1', 'typeC', 'IDLE'),
      makeEntity('d1', 'typeD', 'IDLE'),
    );
    const rels: RelationInstance[] = [
      { name: 'a_b', sourceId: 'a1', targetId: 'b1' },
      { name: 'a_c', sourceId: 'a1', targetId: 'c1' },
      { name: 'b_d', sourceId: 'b1', targetId: 'd1' },
      { name: 'c_d', sourceId: 'c1', targetId: 'd1' },
    ];

    const result = orchestrator.simulate(entities, rels, {}, {
      entityId: 'a1',
      targetStatus: 'ACTIVE',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // B and C should transition
    expect(result.trace.steps.map((s) => s.entityId)).toContain('b1');
    expect(result.trace.steps.map((s) => s.entityId)).toContain('c1');
    // D should be unresolved (conflicting targets X and Y)
    expect(result.trace.unresolved).toHaveLength(1);
    expect(result.trace.unresolved[0].entityId).toBe('d1');
    expect(result.trace.unresolved[0].conflictingTargets).toContain('X');
    expect(result.trace.unresolved[0].conflictingTargets).toContain('Y');
    // D should NOT appear in steps
    expect(result.trace.steps.map((s) => s.entityId)).not.toContain('d1');
  });
});

describe('long cascade chains', () => {
  it('10-hop chain at exact maxCascadeDepth=10 boundary → converged', () => {
    const chain = buildChain(11); // 11 entities = 10 hops
    const orchestrator = buildOrchestrator({
      machines: chain.machines,
      relations: chain.relations,
      maxCascadeDepth: 10,
    });

    const result = orchestrator.simulate(chain.entities, chain.relationInstances, {}, {
      entityId: 'e0',
      targetStatus: 'ACTIVE',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trace.converged).toBe(true);
    expect(result.trace.steps).toHaveLength(10);
    expect(result.trace.finalStates.get('e10')).toBe('ACTIVE');
  });

  it('11-hop chain exceeds maxCascadeDepth=10 → not converged', () => {
    const chain = buildChain(12); // 12 entities = 11 hops
    const orchestrator = buildOrchestrator({
      machines: chain.machines,
      relations: chain.relations,
      maxCascadeDepth: 10,
    });

    const result = orchestrator.simulate(chain.entities, chain.relationInstances, {}, {
      entityId: 'e0',
      targetStatus: 'ACTIVE',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trace.converged).toBe(false);
    // Last entity should NOT have transitioned
    expect(result.trace.finalStates.get('e11')).toBe('IDLE');
  });

  it('maxCascadeDepth=1 limits to single hop', () => {
    const chain = buildChain(4);
    const orchestrator = buildOrchestrator({
      machines: chain.machines,
      relations: chain.relations,
      maxCascadeDepth: 1,
    });

    const result = orchestrator.simulate(chain.entities, chain.relationInstances, {}, {
      entityId: 'e0',
      targetStatus: 'ACTIVE',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trace.steps).toHaveLength(1);
    expect(result.trace.steps[0].entityId).toBe('e1');
    expect(result.trace.finalStates.get('e2')).toBe('IDLE');
  });
});

describe('mixed forward/reverse relations', () => {
  it('forward and reverse relations both fire in single cascade', () => {
    const orchestrator = buildOrchestrator({
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
        { name: 'c_a', source: 'typeC', target: 'typeA', direction: 'reverse' },
      ],
    });

    const entities = buildEntityMap(
      makeEntity('a1', 'typeA', 'IDLE'),
      makeEntity('b1', 'typeB', 'IDLE'),
      makeEntity('c1', 'typeC', 'IDLE'),
    );
    const rels: RelationInstance[] = [
      { name: 'a_b', sourceId: 'a1', targetId: 'b1' },
      { name: 'c_a', sourceId: 'c1', targetId: 'a1' },
    ];

    const result = orchestrator.simulate(entities, rels, {}, {
      entityId: 'a1',
      targetStatus: 'ACTIVE',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stepIds = result.trace.steps.map((s) => s.entityId);
    expect(stepIds).toContain('b1');
    expect(stepIds).toContain('c1');
  });

  it('mixed directions create cycle → not converged', () => {
    // Forward: A changes → B re-evaluates (source=typeA, target=typeB, default)
    // Reverse: B changes → A re-evaluates (source=typeA, target=typeB, reverse:
    //   when def.target (typeB) matches change type, re-evaluate source (typeA))
    const orchestrator = buildOrchestrator({
      machines: {
        typeA: {
          rules: [
            { from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] },
            { from: 'ACTIVE', to: 'IDLE', conditions: [{ fn: 'always_met', args: {} }] },
          ],
        },
        typeB: {
          rules: [
            { from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] },
            { from: 'ACTIVE', to: 'IDLE', conditions: [{ fn: 'always_met', args: {} }] },
          ],
        },
      },
      relations: [
        { name: 'a_b_fwd', source: 'typeA', target: 'typeB' },
        { name: 'b_a_rev', source: 'typeA', target: 'typeB', direction: 'reverse' },
      ],
      maxCascadeDepth: 3,
    });

    const entities = buildEntityMap(
      makeEntity('a1', 'typeA', 'IDLE'),
      makeEntity('b1', 'typeB', 'IDLE'),
    );
    const rels: RelationInstance[] = [
      { name: 'a_b_fwd', sourceId: 'a1', targetId: 'b1' },
      { name: 'b_a_rev', sourceId: 'a1', targetId: 'b1' },
    ];

    const result = orchestrator.simulate(entities, rels, {}, {
      entityId: 'a1',
      targetStatus: 'ACTIVE',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trace.converged).toBe(false);
  });
});

describe('wide fan-out', () => {
  it('single trigger cascades to 10 siblings in round 1', () => {
    const machines: Record<string, { rules: { from: string; to: string; conditions: { fn: string; args: Record<string, unknown> }[] }[] }> = {
      typeA: { rules: [] },
    };
    const entities = buildEntityMap(makeEntity('a1', 'typeA', 'IDLE'));
    const relations: RelationDefinition[] = [];
    const rels: RelationInstance[] = [];

    for (let i = 0; i < 10; i++) {
      const typeName = `child_${i}`;
      machines[typeName] = {
        rules: [{ from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] }],
      };
      entities.set(`c${i}`, { id: `c${i}`, type: typeName, status: 'IDLE', meta: {} });
      relations.push({ name: `rel_${i}`, source: 'typeA', target: typeName });
      rels.push({ name: `rel_${i}`, sourceId: 'a1', targetId: `c${i}` });
    }

    const orchestrator = buildOrchestrator({ machines, relations });

    const result = orchestrator.simulate(entities, rels, {}, {
      entityId: 'a1',
      targetStatus: 'ACTIVE',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trace.steps).toHaveLength(10);
    // All in round 1
    for (const step of result.trace.steps) {
      expect(step.round).toBe(1);
    }
  });
});

describe('disconnected subgraph', () => {
  it('trigger entity with no connected relations — no cascade steps', () => {
    const orchestrator = buildOrchestrator({
      machines: {
        typeA: { rules: [] },
        typeB: {
          rules: [{ from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] }],
        },
      },
      relations: [{ name: 'a_b', source: 'typeA', target: 'typeB' }],
    });

    const entities = buildEntityMap(
      makeEntity('a1', 'typeA', 'IDLE'),
      makeEntity('b1', 'typeB', 'IDLE'),
    );
    // No relation instances connecting a1 to b1
    const rels: RelationInstance[] = [];

    const result = orchestrator.simulate(entities, rels, {}, {
      entityId: 'a1',
      targetStatus: 'ACTIVE',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trace.steps).toHaveLength(0);
    expect(result.trace.finalStates.get('b1')).toBe('IDLE');
  });
});

describe('invariant verification', () => {
  it('cascade steps in strict BFS order (rounds monotonically non-decreasing)', () => {
    const chain = buildChain(5); // 4 hops
    const orchestrator = buildOrchestrator({
      machines: chain.machines,
      relations: chain.relations,
    });

    const result = orchestrator.simulate(chain.entities, chain.relationInstances, {}, {
      entityId: 'e0',
      targetStatus: 'ACTIVE',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (let i = 1; i < result.trace.steps.length; i++) {
      expect(result.trace.steps[i].round).toBeGreaterThanOrEqual(result.trace.steps[i - 1].round);
    }
  });

  it('conflict blocks propagation absolutely through 3-hop chain', () => {
    // A → B(conflict) → C → D; neither C nor D affected
    const orchestrator = buildOrchestrator({
      machines: {
        typeA: { rules: [] },
        typeB: {
          rules: [
            { from: 'IDLE', to: 'X', conditions: [{ fn: 'always_met', args: {} }] },
            { from: 'IDLE', to: 'Y', conditions: [{ fn: 'always_met', args: {} }] },
          ],
        },
        typeC: {
          rules: [{ from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] }],
        },
        typeD: {
          rules: [{ from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] }],
        },
      },
      relations: [
        { name: 'a_b', source: 'typeA', target: 'typeB' },
        { name: 'b_c', source: 'typeB', target: 'typeC' },
        { name: 'c_d', source: 'typeC', target: 'typeD' },
      ],
    });

    const entities = buildEntityMap(
      makeEntity('a1', 'typeA', 'IDLE'),
      makeEntity('b1', 'typeB', 'IDLE'),
      makeEntity('c1', 'typeC', 'IDLE'),
      makeEntity('d1', 'typeD', 'IDLE'),
    );
    const rels: RelationInstance[] = [
      { name: 'a_b', sourceId: 'a1', targetId: 'b1' },
      { name: 'b_c', sourceId: 'b1', targetId: 'c1' },
      { name: 'c_d', sourceId: 'c1', targetId: 'd1' },
    ];

    const result = orchestrator.simulate(entities, rels, {}, {
      entityId: 'a1',
      targetStatus: 'ACTIVE',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // B is unresolved
    expect(result.trace.unresolved).toHaveLength(1);
    expect(result.trace.unresolved[0].entityId).toBe('b1');
    // C and D should NOT be in steps
    const stepIds = result.trace.steps.map((s) => s.entityId);
    expect(stepIds).not.toContain('c1');
    expect(stepIds).not.toContain('d1');
    // C and D remain IDLE
    expect(result.trace.finalStates.get('c1')).toBe('IDLE');
    expect(result.trace.finalStates.get('d1')).toBe('IDLE');
  });

  it('changeset.changes[0] is always the trigger', () => {
    const orchestrator = buildOrchestrator({
      machines: {
        typeA: {
          rules: [{ from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] }],
        },
        typeB: {
          rules: [{ from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] }],
        },
      },
      relations: [{ name: 'a_b', source: 'typeA', target: 'typeB' }],
    });

    const entities = buildEntityMap(
      makeEntity('a1', 'typeA', 'IDLE'),
      makeEntity('b1', 'typeB', 'IDLE'),
    );
    const rels: RelationInstance[] = [{ name: 'a_b', sourceId: 'a1', targetId: 'b1' }];

    const result = orchestrator.execute(entities, rels, {}, {
      entityId: 'a1',
      targetStatus: 'ACTIVE',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changeset.changes[0]).toEqual({
      entityId: 'a1',
      entityType: 'typeA',
      from: 'IDLE',
      to: 'ACTIVE',
    });
  });

  it('converged=false is distinct from cascade_error', () => {
    const chain = buildChain(4);
    const orchestrator = buildOrchestrator({
      machines: chain.machines,
      relations: chain.relations,
      maxCascadeDepth: 1,
    });

    const result = orchestrator.simulate(chain.entities, chain.relationInstances, {}, {
      entityId: 'e0',
      targetStatus: 'ACTIVE',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trace.converged).toBe(false);
    // No error — just depth exceeded
    expect(result.trace.error).toBeUndefined();
  });
});

describe('default maxCascadeDepth', () => {
  it('omitting maxCascadeDepth defaults to 10', () => {
    // 12-hop chain needs depth > 10 to fully converge
    const chain = buildChain(12);
    const engine = createEngine<unknown>({
      presets: { always_met: alwaysMet },
    });
    // No maxCascadeDepth — should default to 10
    const orchestrator = createOrchestrator<unknown>({
      engine,
      machines: chain.machines,
      relations: chain.relations,
    });

    const result = orchestrator.simulate(chain.entities, chain.relationInstances, {}, {
      entityId: 'e0',
      targetStatus: 'ACTIVE',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 11 hops exceeds default depth of 10 → not converged
    expect(result.trace.converged).toBe(false);
    expect(result.trace.rounds).toBe(10);
    expect(result.trace.steps).toHaveLength(10);
    // e11 should NOT have transitioned (round 11 > maxDepth 10)
    expect(result.trace.finalStates.get('e11')).toBe('IDLE');
  });
});

describe('propagateAll direct contract', () => {
  it('returns true for any change/relation pair', () => {
    const change = { entityId: 'a1', entityType: 'typeA', from: 'X', to: 'Y' };
    const relation = { name: 'rel', sourceId: 'a1', targetId: 'b1' };
    expect(propagateAll(change, relation)).toBe(true);
  });
});

describe('partial fan-out', () => {
  it('only siblings meeting conditions transition; others stay unchanged', () => {
    const orchestrator = buildOrchestrator({
      machines: {
        parent: { rules: [] },
        child: {
          rules: [{
            from: 'IDLE',
            to: 'ACTIVE',
            conditions: [{ fn: 'field_equals', args: { field: 'ready', value: true } }],
          }],
        },
      },
      relations: [{ name: 'parent_child', source: 'parent', target: 'child' }],
    });

    const entities = buildEntityMap(
      makeEntity('p1', 'parent', 'IDLE'),
      makeEntity('c1', 'child', 'IDLE', { ready: true }),
      makeEntity('c2', 'child', 'IDLE', { ready: true }),
      makeEntity('c3', 'child', 'IDLE', { ready: false }),
    );
    const rels: RelationInstance[] = [
      { name: 'parent_child', sourceId: 'p1', targetId: 'c1' },
      { name: 'parent_child', sourceId: 'p1', targetId: 'c2' },
      { name: 'parent_child', sourceId: 'p1', targetId: 'c3' },
    ];

    const result = orchestrator.simulate(entities, rels, {}, {
      entityId: 'p1',
      targetStatus: 'ACTIVE',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Only c1 and c2 should transition (ready=true)
    expect(result.trace.steps).toHaveLength(2);
    const transitionedIds = result.trace.steps.map((s) => s.entityId).sort();
    expect(transitionedIds).toEqual(['c1', 'c2']);
    // c3 should remain IDLE
    expect(result.trace.finalStates.get('c3')).toBe('IDLE');
    // c1 and c2 should be ACTIVE
    expect(result.trace.finalStates.get('c1')).toBe('ACTIVE');
    expect(result.trace.finalStates.get('c2')).toBe('ACTIVE');
  });
});
