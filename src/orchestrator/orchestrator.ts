import type {
  Engine,
  Entity,
  TransitionRule,
  ManualTransition,
  ValidTransition,
} from '../engine/types.js';
import type {
  CascadeStep,
  CascadeTrace,
  Changeset,
  ExecutionResult,
  OrchestratorConfig,
  Orchestrator,
  PropagationStrategy,
  RelationDefinition,
  RelationInstance,
  SimulationResult,
  StateChange,
  UnresolvedEntity,
  AvailableManualTransition,
} from './types.js';
import { propagateAll } from './types.js';
import { StateOverlay } from './overlay.js';

interface QueueEntry {
  entityId: string;
  triggeredBy: string[];
  round: number;
}

/**
 * Find downstream entity IDs to re-evaluate after a state change.
 * Uses relation definitions for type-level matching and relation instances for instance-level targeting.
 */
function findDownstream(
  change: StateChange,
  relationDefs: RelationDefinition[],
  relationInstances: RelationInstance[],
  propagation: PropagationStrategy,
): string[] {
  const targets: string[] = [];

  for (const def of relationDefs) {
    const direction = def.direction ?? 'default';
    let matchesSource: boolean;
    let getTargetId: (ri: RelationInstance) => string;

    if (direction === 'default') {
      // source changes -> re-evaluate target
      matchesSource = def.source === change.entityType;
      getTargetId = (ri) => ri.targetId;
    } else {
      // reverse: target changes -> re-evaluate source
      matchesSource = def.target === change.entityType;
      getTargetId = (ri) => ri.sourceId;
    }

    if (!matchesSource) continue;

    // Find concrete instances for this relation definition
    for (const ri of relationInstances) {
      if (ri.name !== def.name) continue;

      // Check if the changed entity is involved in this instance
      const isChangedEntity =
        direction === 'default' ? ri.sourceId === change.entityId : ri.targetId === change.entityId;
      if (!isChangedEntity) continue;

      // Apply propagation strategy
      if (!propagation(change, ri)) continue;

      const targetId = getTargetId(ri);
      if (!targets.includes(targetId)) {
        targets.push(targetId);
      }
    }
  }

  return targets;
}

/**
 * Run BFS cascade from a trigger state change.
 */
function runCascade<TContext>(
  overlay: StateOverlay,
  relationInstances: RelationInstance[],
  relationDefs: RelationDefinition[],
  context: TContext,
  triggerChange: StateChange,
  machines: Record<string, { rules: TransitionRule[]; manualTransitions?: ManualTransition[] }>,
  engine: Engine<TContext>,
  propagation: PropagationStrategy,
  maxDepth: number,
): CascadeTrace {
  const steps: CascadeStep[] = [];
  const unresolved: UnresolvedEntity[] = [];
  const availableManualTransitions: AvailableManualTransition[] = [];
  const affected = new Set<string>();

  // Seed the queue with downstream of the trigger
  const initialDownstream = findDownstream(
    triggerChange,
    relationDefs,
    relationInstances,
    propagation,
  );
  const queue: QueueEntry[] = initialDownstream.map((id) => ({
    entityId: id,
    triggeredBy: [triggerChange.entityId],
    round: 1,
  }));

  let currentRound = 0;
  let converged = true;

  while (queue.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const entry = queue.shift()!;

    if (entry.round > maxDepth) {
      converged = false;
      // Put it back conceptually — we just stop processing
      continue;
    }

    currentRound = Math.max(currentRound, entry.round);

    const entity = overlay.get(entry.entityId);
    if (!entity) continue; // Missing entity — skip gracefully

    affected.add(entry.entityId);

    const machine = machines[entity.type];
    if (!machine) continue; // No machine for this entity type

    const validTransitions = engine.getValidTransitions(
      entity,
      context,
      machine.rules,
      machine.manualTransitions,
    );

    // Separate auto and manual transitions
    const autoTransitions = validTransitions.filter((vt) => vt.rule !== null);
    const manualTransitions = validTransitions.filter((vt) => vt.rule === null);

    // Report new manual transitions
    for (const mt of manualTransitions) {
      availableManualTransitions.push({
        entityId: entity.id,
        entityType: entity.type,
        from: entity.status,
        to: mt.status,
      });
    }

    // Deduplicate auto transitions by target status
    const uniqueAutoTargets = new Map<string, ValidTransition>();
    for (const at of autoTransitions) {
      if (!uniqueAutoTargets.has(at.status)) {
        uniqueAutoTargets.set(at.status, at);
      }
    }

    const uniqueAutos = [...uniqueAutoTargets.values()];

    if (uniqueAutos.length === 1) {
      // Single match — apply
      const match = uniqueAutos[0];
      const change: StateChange = {
        entityId: entity.id,
        entityType: entity.type,
        from: entity.status,
        to: match.status,
      };

      // Apply to overlay
      overlay.set(entity.id, { ...entity, status: match.status });

      steps.push({
        ...change,
        round: entry.round,
        triggeredBy: entry.triggeredBy,
        rule: match.rule as TransitionRule,
      });

      // Enqueue downstream — matchedIds targeting takes precedence
      let downstream: string[];
      if (match.matchedIds.length > 0) {
        // Instance-level targeting: only re-evaluate entities referenced by matchedIds
        downstream = match.matchedIds;
      } else {
        // Fallback: relation-instance-based propagation
        downstream = findDownstream(change, relationDefs, relationInstances, propagation);
      }
      for (const id of downstream) {
        queue.push({
          entityId: id,
          triggeredBy: [entity.id],
          round: entry.round + 1,
        });
      }
    } else if (uniqueAutos.length > 1) {
      // Multi match — conflict
      unresolved.push({
        entityId: entity.id,
        entityType: entity.type,
        currentStatus: entity.status,
        conflictingTargets: uniqueAutos.map((a) => a.status),
        round: entry.round,
      });

      // Unresolved entity didn't transition — explore downstream with pre-cascade state
      // (per research.md Decision 5: use current/pre-cascade state)
    }
    // No match — skip silently
  }

  return {
    trigger: triggerChange,
    steps,
    unresolved,
    availableManualTransitions,
    affected: [...affected],
    finalStates: overlay.snapshot(),
    converged,
    rounds: currentRound,
  };
}

/**
 * Create an orchestrator for multi-entity cascade simulation and execution.
 */
export function createOrchestrator<TContext>(
  config: OrchestratorConfig<TContext>,
): Orchestrator<TContext> {
  const {
    engine,
    machines,
    relations: relationDefs,
    propagation = propagateAll,
    maxCascadeDepth = 10,
  } = config;

  function simulate(
    entities: Map<string, Entity>,
    relations: RelationInstance[],
    context: TContext,
    trigger: { entityId: string; targetStatus: string },
  ): SimulationResult {
    const entity = entities.get(trigger.entityId);
    if (!entity) {
      return { ok: false, error: 'entity_not_found', entityId: trigger.entityId };
    }

    const overlay = new StateOverlay(entities);

    // Force trigger status (what-if mode)
    const triggerChange: StateChange = {
      entityId: entity.id,
      entityType: entity.type,
      from: entity.status,
      to: trigger.targetStatus,
    };
    overlay.set(entity.id, { ...entity, status: trigger.targetStatus });

    try {
      const trace = runCascade(
        overlay,
        relations,
        relationDefs,
        context,
        triggerChange,
        machines,
        engine,
        propagation,
        maxCascadeDepth,
      );
      return { ok: true, trace };
    } catch {
      // Preset threw during cascade — return partial trace
      const partialTrace: CascadeTrace = {
        trigger: triggerChange,
        steps: [],
        unresolved: [],
        availableManualTransitions: [],
        affected: [],
        finalStates: overlay.snapshot(),
        converged: false,
        rounds: 0,
      };
      return { ok: false, error: 'cascade_error', partialTrace };
    }
  }

  function execute(
    entities: Map<string, Entity>,
    relations: RelationInstance[],
    context: TContext,
    trigger: { entityId: string; targetStatus: string },
  ): ExecutionResult {
    const entity = entities.get(trigger.entityId);
    if (!entity) {
      return { ok: false, error: 'entity_not_found', entityId: trigger.entityId };
    }

    // Validate trigger transition
    const machine = machines[entity.type];
    if (!machine) {
      return {
        ok: false,
        error: 'validation_failed',
        reason: `No machine found for entity type "${entity.type}"`,
      };
    }

    const validation = engine.validate(
      entity,
      context,
      machine.rules,
      trigger.targetStatus,
      machine.manualTransitions,
    );

    if (!validation.valid) {
      return { ok: false, error: 'validation_failed', reason: validation.reason };
    }

    const overlay = new StateOverlay(entities);

    const triggerChange: StateChange = {
      entityId: entity.id,
      entityType: entity.type,
      from: entity.status,
      to: trigger.targetStatus,
    };
    overlay.set(entity.id, { ...entity, status: trigger.targetStatus });

    try {
      const trace = runCascade(
        overlay,
        relations,
        relationDefs,
        context,
        triggerChange,
        machines,
        engine,
        propagation,
        maxCascadeDepth,
      );

      const changeset: Changeset = {
        changes: [triggerChange, ...trace.steps],
        trace,
        unresolved: trace.unresolved,
      };

      return { ok: true, changeset };
    } catch {
      const partialTrace: CascadeTrace = {
        trigger: triggerChange,
        steps: [],
        unresolved: [],
        availableManualTransitions: [],
        affected: [],
        finalStates: overlay.snapshot(),
        converged: false,
        rounds: 0,
      };
      return { ok: false, error: 'cascade_error', partialTrace };
    }
  }

  return { simulate, execute };
}
