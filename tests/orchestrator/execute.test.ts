import { describe, it, expect } from 'vitest';
import { createEngine } from '../../src/engine/engine.js';
import { createOrchestrator } from '../../src/orchestrator/orchestrator.js';
import type { Entity, PresetResult } from '../../src/engine/types.js';
import type { RelationDefinition, RelationInstance } from '../../src/orchestrator/types.js';
import { buildEntityMap, makeEntity, fieldEquals, alwaysMet, throwingPreset } from './fixtures.js';

function buildOrchestrator(opts: {
  machines: Parameters<typeof createOrchestrator>[0]['machines'];
  relations: RelationDefinition[];
}) {
  const engine = createEngine<unknown>({
    presets: { field_equals: fieldEquals, always_met: alwaysMet },
  });
  return createOrchestrator<unknown>({
    engine,
    machines: opts.machines,
    relations: opts.relations,
  });
}

describe('execute()', () => {
  it('valid auto transition produces changeset with ok: true', () => {
    const orchestrator = buildOrchestrator({
      machines: {
        typeA: {
          rules: [{ from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] }],
        },
      },
      relations: [],
    });

    const entities = buildEntityMap(makeEntity('a1', 'typeA', 'IDLE'));
    const result = orchestrator.execute(
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
    expect(result.changeset).toBeDefined();
  });

  it('changeset.changes includes trigger as first entry', () => {
    const orchestrator = buildOrchestrator({
      machines: {
        typeA: {
          rules: [{ from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] }],
        },
      },
      relations: [],
    });

    const entities = buildEntityMap(makeEntity('a1', 'typeA', 'IDLE'));
    const result = orchestrator.execute(
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
    expect(result.changeset.changes[0]).toEqual({
      entityId: 'a1',
      entityType: 'typeA',
      from: 'IDLE',
      to: 'ACTIVE',
    });
  });

  it('changeset.changes includes cascade steps after trigger', () => {
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

    const result = orchestrator.execute(
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
    expect(result.changeset.changes).toHaveLength(2);
    expect(result.changeset.changes[0].entityId).toBe('a1');
    expect(result.changeset.changes[1].entityId).toBe('b1');
    expect(result.changeset.changes[1].to).toBe('ACTIVE');
  });

  it('changeset.trace is a complete CascadeTrace', () => {
    const orchestrator = buildOrchestrator({
      machines: {
        typeA: {
          rules: [{ from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] }],
        },
      },
      relations: [],
    });

    const entities = buildEntityMap(makeEntity('a1', 'typeA', 'IDLE'));
    const result = orchestrator.execute(
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
    const trace = result.changeset.trace;
    expect(trace.trigger).toEqual({
      entityId: 'a1',
      entityType: 'typeA',
      from: 'IDLE',
      to: 'ACTIVE',
    });
    expect(trace.steps).toHaveLength(0);
    expect(trace.unresolved).toHaveLength(0);
    expect(trace.finalStates.get('a1')).toBe('ACTIVE');
    expect(trace.converged).toBe(true);
    expect(trace.rounds).toBe(0);
  });

  it('changeset.unresolved is shortcut to trace.unresolved', () => {
    // Set up conflict: two auto transitions from same status
    const orchestrator = buildOrchestrator({
      machines: {
        typeA: {
          rules: [{ from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] }],
        },
        typeB: {
          rules: [
            { from: 'IDLE', to: 'X', conditions: [{ fn: 'always_met', args: {} }] },
            { from: 'IDLE', to: 'Y', conditions: [{ fn: 'always_met', args: {} }] },
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

    const result = orchestrator.execute(
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
    expect(result.changeset.unresolved).toBe(result.changeset.trace.unresolved);
  });

  it('invalid transition returns validation_failed with reason', () => {
    const orchestrator = buildOrchestrator({
      machines: {
        typeA: {
          rules: [
            {
              from: 'IDLE',
              to: 'ACTIVE',
              conditions: [{ fn: 'field_equals', args: { field: 'ready', value: true } }],
            },
          ],
        },
      },
      relations: [],
    });

    // ready is false, so IDLE->ACTIVE won't be valid
    const entities = buildEntityMap(makeEntity('a1', 'typeA', 'IDLE', { ready: false }));
    const result = orchestrator.execute(
      entities,
      [],
      {},
      {
        entityId: 'a1',
        targetStatus: 'ACTIVE',
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('validation_failed');
    if (result.error === 'validation_failed') {
      expect(result.reason).toBeDefined();
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });

  it('entity_not_found when trigger entity missing from map', () => {
    const orchestrator = buildOrchestrator({
      machines: {},
      relations: [],
    });

    const result = orchestrator.execute(
      new Map(),
      [],
      {},
      {
        entityId: 'missing',
        targetStatus: 'X',
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('entity_not_found');
    if (result.error === 'entity_not_found') {
      expect(result.entityId).toBe('missing');
    }
  });

  it('execute result matches simulate prediction', () => {
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
    const trigger = { entityId: 'a1', targetStatus: 'ACTIVE' };

    const simResult = orchestrator.simulate(entities, rels, {}, trigger);
    const execResult = orchestrator.execute(entities, rels, {}, trigger);

    expect(simResult.ok).toBe(true);
    expect(execResult.ok).toBe(true);
    if (!simResult.ok || !execResult.ok) return;

    // Same final states
    expect(execResult.changeset.trace.finalStates.get('a1')).toBe(
      simResult.trace.finalStates.get('a1'),
    );
    expect(execResult.changeset.trace.finalStates.get('b1')).toBe(
      simResult.trace.finalStates.get('b1'),
    );

    // Same cascade step count
    expect(execResult.changeset.trace.steps).toHaveLength(simResult.trace.steps.length);
  });

  it('valid manual transition produces changeset', () => {
    const orchestrator = buildOrchestrator({
      machines: {
        typeA: {
          rules: [],
          manualTransitions: [{ from: 'IDLE', to: 'DONE' }],
        },
      },
      relations: [],
    });

    const entities = buildEntityMap(makeEntity('a1', 'typeA', 'IDLE'));
    const result = orchestrator.execute(
      entities,
      [],
      {},
      {
        entityId: 'a1',
        targetStatus: 'DONE',
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changeset.changes[0].to).toBe('DONE');
  });

  it('cascade error in execute() returns partial trace with error message', () => {
    const engine = createEngine<unknown>({
      presets: { always_met: alwaysMet, throw_preset: throwingPreset },
    });
    const orchestrator = createOrchestrator<unknown>({
      engine,
      machines: {
        typeA: {
          rules: [{ from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] }],
        },
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

    const result = orchestrator.execute(
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
      expect(result.partialTrace.error).toBe('Preset evaluation failed');
      expect(result.partialTrace.converged).toBe(false);
    }
  });

  it('"No machine found" returns validation_failed', () => {
    const orchestrator = buildOrchestrator({
      machines: {
        // No machine for typeA
      },
      relations: [],
    });

    const entities = buildEntityMap(makeEntity('a1', 'typeA', 'IDLE'));
    const result = orchestrator.execute(
      entities,
      [],
      {},
      {
        entityId: 'a1',
        targetStatus: 'ACTIVE',
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('validation_failed');
    if (result.error === 'validation_failed') {
      expect(result.reason).toContain('No machine found');
      expect(result.reason).toContain('typeA');
    }
  });

  it('execute() validates against base context, cascade uses enriched context', () => {
    // A preset that requires context.threshold to be low to pass
    const thresholdPreset = (
      _entity: Entity,
      context: unknown,
      _args: Record<string, unknown>,
    ): PresetResult => ({
      met: (context as { threshold: number }).threshold < 10,
      matchedIds: [],
    });

    const engine = createEngine<{ threshold: number }>({
      presets: { always_met: alwaysMet, threshold_check: thresholdPreset },
    });

    const orchestrator = createOrchestrator<{ threshold: number }>({
      engine,
      machines: {
        typeA: {
          rules: [{ from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] }],
        },
        typeB: {
          rules: [
            { from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'threshold_check', args: {} }] },
          ],
        },
      },
      relations: [{ name: 'a_b', source: 'typeA', target: 'typeB' }],
      // Enricher sets threshold to 100 (blocks threshold_check)
      contextEnricher: (base, _getStatus) => ({ ...base, threshold: 100 }),
    });

    const entities = buildEntityMap(
      makeEntity('a1', 'typeA', 'IDLE'),
      makeEntity('b1', 'typeB', 'IDLE'),
    );
    const rels: RelationInstance[] = [{ name: 'a_b', sourceId: 'a1', targetId: 'b1' }];

    // Base context passes threshold_check (threshold=5 < 10)
    // But enriched context blocks it (threshold=100 >= 10)
    const result = orchestrator.execute(entities, rels, { threshold: 5 }, {
      entityId: 'a1',
      targetStatus: 'ACTIVE',
    });

    // Trigger validation uses base context (threshold=5) → passes
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Cascade uses enriched context (threshold=100) → B does NOT transition
    expect(result.changeset.changes).toHaveLength(1); // trigger only, no cascade step
    expect(result.changeset.trace.steps).toHaveLength(0);
  });

  it('contextEnricher enables cascade that base context would block', () => {
    // Inverse of the test above: base context blocks, enricher enables.
    const thresholdPreset = (
      _entity: Entity,
      context: unknown,
      _args: Record<string, unknown>,
    ): PresetResult => ({
      met: (context as { threshold: number }).threshold < 10,
      matchedIds: [],
    });

    const engine = createEngine<{ threshold: number }>({
      presets: { always_met: alwaysMet, threshold_check: thresholdPreset },
    });

    const orchestrator = createOrchestrator<{ threshold: number }>({
      engine,
      machines: {
        typeA: {
          rules: [{ from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] }],
        },
        typeB: {
          rules: [
            { from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'threshold_check', args: {} }] },
          ],
        },
      },
      relations: [{ name: 'a_b', source: 'typeA', target: 'typeB' }],
      // Enricher lowers threshold to 1 (enables threshold_check)
      contextEnricher: (base, _getStatus) => ({ ...base, threshold: 1 }),
    });

    const entities = buildEntityMap(
      makeEntity('a1', 'typeA', 'IDLE'),
      makeEntity('b1', 'typeB', 'IDLE'),
    );
    const rels: RelationInstance[] = [{ name: 'a_b', sourceId: 'a1', targetId: 'b1' }];

    // Base context blocks threshold_check (threshold=100 >= 10)
    // But enriched context enables it (threshold=1 < 10)
    const result = orchestrator.execute(entities, rels, { threshold: 100 }, {
      entityId: 'a1',
      targetStatus: 'ACTIVE',
    });

    // Trigger validation uses base context but A's rule is always_met → passes
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Cascade uses enriched context (threshold=1) → B transitions
    expect(result.changeset.changes).toHaveLength(2); // trigger + B's cascade step
    expect(result.changeset.trace.steps).toHaveLength(1);
    expect(result.changeset.trace.steps[0].entityId).toBe('b1');
    expect(result.changeset.trace.steps[0].to).toBe('ACTIVE');
  });

  it('cascade error with empty error message still returns ok: false', () => {
    const emptyErrorPreset = (): PresetResult => {
      throw new Error('');
    };

    const engine = createEngine<unknown>({
      presets: { always_met: alwaysMet, empty_error: emptyErrorPreset },
    });
    const orchestrator = createOrchestrator<unknown>({
      engine,
      machines: {
        typeA: {
          rules: [{ from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'always_met', args: {} }] }],
        },
        typeB: {
          rules: [{ from: 'IDLE', to: 'ACTIVE', conditions: [{ fn: 'empty_error', args: {} }] }],
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

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('cascade_error');
    if (result.error === 'cascade_error') {
      expect(result.partialTrace.error).toBe('');
      expect(result.partialTrace.converged).toBe(false);
    }
  });
});
