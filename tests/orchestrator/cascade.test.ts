import { describe, it, expect } from 'vitest';
import { createEngine } from '../../src/engine/engine.js';
import { createOrchestrator } from '../../src/orchestrator/orchestrator.js';
import type { RelationDefinition, RelationInstance } from '../../src/orchestrator/types.js';
import {
  buildEntityMap,
  makeEntity,
  fieldEquals,
  alwaysMet,
  throwingPreset,
  throwingNonErrorPreset,
  returnsIds,
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
    expect(result.trace.steps[1].entityId).toBe('c1');
    expect(result.trace.steps[1].to).toBe('ACTIVE');
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
    // b1 should NOT appear in steps (not applied)
    expect(result.trace.steps.find((s) => s.entityId === 'b1')).toBeUndefined();
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
});
