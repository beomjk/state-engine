import { describe, it, expect } from 'vitest';
import { createEngine } from '../../src/engine/engine.js';
import { createOrchestrator } from '../../src/orchestrator/orchestrator.js';
import type { RelationDefinition, RelationInstance } from '../../src/orchestrator/types.js';
import { buildEntityMap, makeEntity, fieldEquals, alwaysMet, throwingPreset } from './fixtures.js';

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
          rules: [
            { from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] },
          ],
        },
        typeC: {
          rules: [
            { from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] },
          ],
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
  });

  it('diamond convergence — A -> B, A -> C, B -> D, C -> D', () => {
    const orchestrator = buildOrchestrator({
      machines: {
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
        typeD: {
          rules: [
            { from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] },
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
    // B and C should both become ACTIVE, then D should become ACTIVE
    expect(result.trace.steps.length).toBeGreaterThanOrEqual(3);
    expect(result.trace.finalStates.get('b1')).toBe('ACTIVE');
    expect(result.trace.finalStates.get('c1')).toBe('ACTIVE');
    expect(result.trace.finalStates.get('d1')).toBe('ACTIVE');
    expect(result.trace.converged).toBe(true);
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

    const result = orchestrator.simulate(entities, rels, {}, {
      entityId: 'a1',
      targetStatus: 'S2',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Should have terminated, not infinite loop
    expect(result.trace.rounds).toBeLessThanOrEqual(5);
  });

  it('converged flag is true when cascade reaches fixed point', () => {
    const orchestrator = buildOrchestrator({
      machines: {
        typeA: { rules: [] },
        typeB: {
          rules: [
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
    const rels: RelationInstance[] = [
      { name: 'a_b', sourceId: 'a1', targetId: 'b1' },
    ];

    const result = orchestrator.simulate(entities, rels, {}, {
      entityId: 'a1',
      targetStatus: 'ACTIVE',
    });

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
    const rels: RelationInstance[] = [
      { name: 'a_b', sourceId: 'a1', targetId: 'b1' },
    ];

    const result = orchestrator.simulate(entities, rels, {}, {
      entityId: 'a1',
      targetStatus: 'ACTIVE',
    });

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
    const rels: RelationInstance[] = [
      { name: 'a_b', sourceId: 'a1', targetId: 'b1' },
    ];

    const result = orchestrator.simulate(entities, rels, {}, {
      entityId: 'a1',
      targetStatus: 'ACTIVE',
    });

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

  it('application order correctness — BFS order', () => {
    // A -> B and A -> C, both at round 1
    const orchestrator = buildOrchestrator({
      machines: {
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

    const result = orchestrator.simulate(entities, rels, {}, {
      entityId: 'a1',
      targetStatus: 'ACTIVE',
    });

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

    const result = orchestrator.simulate(new Map(), [], {}, {
      entityId: 'x',
      targetStatus: 'Y',
    });

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

    const result = orchestrator.simulate(entities, [], {}, {
      entityId: 'a1',
      targetStatus: 'ACTIVE',
    });

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

    const result = orchestrator.simulate(entities, rels, {}, {
      entityId: 'a1',
      targetStatus: 'S2',
    });

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
          rules: [
            { from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'throw_preset', args: {} }] },
          ],
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
    const rels: RelationInstance[] = [
      { name: 'a_b', sourceId: 'a1', targetId: 'b1' },
    ];

    const result = orchestrator.simulate(entities, rels, {}, {
      entityId: 'a1',
      targetStatus: 'ACTIVE',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('cascade_error');
    if (result.error === 'cascade_error') {
      expect(result.partialTrace).toBeDefined();
      expect(result.partialTrace.trigger.entityId).toBe('a1');
    }
  });

  it('missing entity in relation — skip gracefully', () => {
    const orchestrator = buildOrchestrator({
      machines: {
        typeA: { rules: [] },
        typeB: {
          rules: [
            { from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] },
          ],
        },
      },
      relations: [{ name: 'a_b', source: 'typeA', target: 'typeB' }],
    });

    const entities = buildEntityMap(
      makeEntity('a1', 'typeA', 'IDLE'),
      // b1 is referenced in relation but NOT in entity map
    );
    const rels: RelationInstance[] = [
      { name: 'a_b', sourceId: 'a1', targetId: 'nonexistent' },
    ];

    const result = orchestrator.simulate(entities, rels, {}, {
      entityId: 'a1',
      targetStatus: 'ACTIVE',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Should complete without error, just skip the missing entity
    expect(result.trace.converged).toBe(true);
  });
});
