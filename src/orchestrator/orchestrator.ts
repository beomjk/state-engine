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
  ContextEnricher,
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

interface RelationIndex {
  /** Key: "relationName:sourceId" */
  bySource: Map<string, RelationInstance[]>;
  /** Key: "relationName:targetId" */
  byTarget: Map<string, RelationInstance[]>;
}

/** Build O(1)-lookup indexes from a flat relation instance array. Single O(R) pass. */
function buildRelationIndex(relationInstances: RelationInstance[]): RelationIndex {
  const bySource = new Map<string, RelationInstance[]>();
  const byTarget = new Map<string, RelationInstance[]>();

  for (const ri of relationInstances) {
    const srcKey = `${ri.name}:${ri.sourceId}`;
    const tgtKey = `${ri.name}:${ri.targetId}`;

    let srcList = bySource.get(srcKey);
    if (!srcList) {
      srcList = [];
      bySource.set(srcKey, srcList);
    }
    srcList.push(ri);

    let tgtList = byTarget.get(tgtKey);
    if (!tgtList) {
      tgtList = [];
      byTarget.set(tgtKey, tgtList);
    }
    tgtList.push(ri);
  }

  return { bySource, byTarget };
}

/**
 * Find downstream entity IDs to re-evaluate after a state change.
 * Uses relation definitions for type-level matching and the pre-built index for instance-level targeting.
 */
function findDownstream(
  change: StateChange,
  relationDefs: RelationDefinition[],
  relationIndex: RelationIndex,
  propagation: PropagationStrategy,
): string[] {
  const targetSet = new Set<string>();

  for (const def of relationDefs) {
    const direction = def.direction ?? 'default';
    let matchesSource: boolean;
    let getTargetId: (ri: RelationInstance) => string;
    let instances: RelationInstance[];

    if (direction === 'default') {
      // source changes -> re-evaluate target
      matchesSource = def.source === change.entityType;
      getTargetId = (ri) => ri.targetId;
      instances = relationIndex.bySource.get(`${def.name}:${change.entityId}`) ?? [];
    } else {
      // reverse: target changes -> re-evaluate source
      matchesSource = def.target === change.entityType;
      getTargetId = (ri) => ri.sourceId;
      instances = relationIndex.byTarget.get(`${def.name}:${change.entityId}`) ?? [];
    }

    if (!matchesSource) continue;

    for (const ri of instances) {
      if (!propagation(change, ri)) continue;
      targetSet.add(getTargetId(ri));
    }
  }

  return [...targetSet];
}

interface CascadeConfig<TContext> {
  overlay: StateOverlay;
  relationInstances: RelationInstance[];
  relationDefs: RelationDefinition[];
  context: TContext;
  triggerChange: StateChange;
  machines: Record<string, { rules: TransitionRule[]; manualTransitions?: ManualTransition[] }>;
  engine: Engine<TContext>;
  propagation: PropagationStrategy;
  maxDepth: number;
  contextEnricher?: ContextEnricher<TContext>;
}

/**
 * Run BFS cascade from a trigger state change.
 */
function runCascade<TContext>(config: CascadeConfig<TContext>): CascadeTrace {
  const {
    overlay,
    relationInstances,
    relationDefs,
    context,
    triggerChange,
    machines,
    engine,
    propagation,
    maxDepth,
  } = config;

  const relationIndex = buildRelationIndex(relationInstances);

  const steps: CascadeStep[] = [];
  const unresolved: UnresolvedEntity[] = [];
  const availableManualTransitions: AvailableManualTransition[] = [];
  const affected = new Set<string>();
  const reportedManualTransitions = new Set<string>();

  // Deduplication: prevent same entity from being evaluated twice in the same round.
  // entryMap provides O(1) lookup for triggeredBy merging (avoids linear queue scan).
  const queue: QueueEntry[] = [];
  const entryMap = new Map<string, QueueEntry>();
  let head = 0; // cursor index — avoids O(n) Array.shift()

  function enqueue(entityId: string, triggeredBy: string[], round: number): void {
    const key = `${entityId}:${round}`;
    const existing = entryMap.get(key);
    if (existing) {
      for (const id of triggeredBy) {
        if (!existing.triggeredBy.includes(id)) {
          existing.triggeredBy.push(id);
        }
      }
      return;
    }
    const entry: QueueEntry = { entityId, triggeredBy: [...triggeredBy], round };
    entryMap.set(key, entry);
    queue.push(entry);
  }

  // Seed the queue with downstream of the trigger
  const initialDownstream = findDownstream(
    triggerChange,
    relationDefs,
    relationIndex,
    propagation,
  );
  for (const id of initialDownstream) {
    enqueue(id, [triggerChange.entityId], 1);
  }

  let currentRound = 0;
  let converged = true;
  let cascadeError: string | undefined;
  let cascadeCause: unknown;

  try {
    while (head < queue.length) {
      const entry = queue[head++];

      if (entry.round > maxDepth) {
        converged = false;
        // All remaining entries have round >= entry.round (BFS monotonic), so stop.
        break;
      }

      currentRound = Math.max(currentRound, entry.round);

      const entity = overlay.get(entry.entityId);
      if (!entity) continue; // Missing entity — skip gracefully

      affected.add(entry.entityId);

      const machine = machines[entity.type];
      if (!machine) continue; // No machine for this entity type

      const evalContext = config.contextEnricher
        ? config.contextEnricher(context, (id) => overlay.get(id)?.status)
        : context;

      const validTransitions = engine.getValidTransitions(
        entity,
        evalContext,
        machine.rules,
        machine.manualTransitions,
      );

      // Separate auto and manual transitions
      const autoTransitions = validTransitions.filter((vt) => vt.rule !== null);
      const manualTransitions = validTransitions.filter((vt) => vt.rule === null);

      // Report new manual transitions (deduplicate across re-evaluations)
      for (const mt of manualTransitions) {
        const mtKey = `${entity.id}:${mt.status}`;
        if (reportedManualTransitions.has(mtKey)) continue;
        reportedManualTransitions.add(mtKey);
        availableManualTransitions.push({
          entityId: entity.id,
          entityType: entity.type,
          from: entity.status,
          to: mt.status,
        });
      }

      // Deduplicate auto transitions by target status, merging matchedIds
      const uniqueAutoTargets = new Map<string, ValidTransition>();
      for (const at of autoTransitions) {
        const existing = uniqueAutoTargets.get(at.status);
        if (!existing) {
          uniqueAutoTargets.set(at.status, at);
        } else {
          for (const id of at.matchedIds) {
            if (!existing.matchedIds.includes(id)) {
              existing.matchedIds.push(id);
            }
          }
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

        // Guard narrows match.rule to non-null (guaranteed by the autoTransitions
        // filter above, but kept for type narrowing and defensive safety).
        /* v8 ignore next */
        if (!match.rule) continue;

        // Apply to overlay
        overlay.set(entity.id, { ...entity, status: match.status });

        steps.push({
          ...change,
          round: entry.round,
          triggeredBy: [...entry.triggeredBy],
          rule: match.rule,
        });

        // Enqueue downstream — matchedIds targeting takes precedence over relation graph
        // and bypasses PropagationStrategy (by design: instance-level targeting overrides type-level filtering)
        let downstream: string[];
        if (match.matchedIds.length > 0) {
          downstream = match.matchedIds;
        } else {
          // Fallback: relation-instance-based propagation
          downstream = findDownstream(change, relationDefs, relationIndex, propagation);
        }
        for (const id of downstream) {
          enqueue(id, [entity.id], entry.round + 1);
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

        // Unresolved: no transition applied, cascade path stops here.
        // Downstream entities are NOT re-evaluated (conflict blocks propagation).
      }
      // No match — skip silently
    }
  } catch (err: unknown) {
    converged = false;
    cascadeError = err instanceof Error ? err.message : String(err);
    cascadeCause = err;
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
    ...(cascadeError !== undefined && { error: cascadeError }),
    ...(cascadeCause !== undefined && { cause: cascadeCause }),
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
    contextEnricher,
  } = config;

  /** Shared setup: find entity, create overlay, build trigger change. */
  function initTrigger(
    entities: Map<string, Entity>,
    trigger: { entityId: string; targetStatus: string },
  ): { entity: Entity; overlay: StateOverlay; triggerChange: StateChange } | null {
    const entity = entities.get(trigger.entityId);
    if (!entity) return null;

    const overlay = new StateOverlay(entities);
    const triggerChange: StateChange = {
      entityId: entity.id,
      entityType: entity.type,
      from: entity.status,
      to: trigger.targetStatus,
    };
    overlay.set(entity.id, { ...entity, status: trigger.targetStatus });
    return { entity, overlay, triggerChange };
  }

  /** Run cascade from an initialized trigger and return the trace. */
  function cascade(
    init: { overlay: StateOverlay; triggerChange: StateChange },
    relations: RelationInstance[],
    context: TContext,
  ): CascadeTrace {
    return runCascade({
      overlay: init.overlay,
      relationInstances: relations,
      relationDefs,
      context,
      triggerChange: init.triggerChange,
      machines,
      engine,
      propagation,
      maxDepth: maxCascadeDepth,
      contextEnricher,
    });
  }

  function simulate(
    entities: Map<string, Entity>,
    relations: RelationInstance[],
    context: TContext,
    trigger: { entityId: string; targetStatus: string },
  ): SimulationResult {
    const init = initTrigger(entities, trigger);
    if (!init) return { ok: false, error: 'entity_not_found', entityId: trigger.entityId };

    const trace = cascade(init, relations, context);

    if (trace.error !== undefined) return { ok: false, error: 'cascade_error', partialTrace: trace };
    return { ok: true, trace };
  }

  /**
   * Validates the trigger transition against the engine first,
   * then runs cascade and returns an applicable changeset.
   *
   * Note: trigger validation uses the base context (not enriched via contextEnricher).
   * The cascade itself uses enriched context for downstream evaluations.
   */
  function execute(
    entities: Map<string, Entity>,
    relations: RelationInstance[],
    context: TContext,
    trigger: { entityId: string; targetStatus: string },
  ): ExecutionResult {
    const init = initTrigger(entities, trigger);
    if (!init) return { ok: false, error: 'entity_not_found', entityId: trigger.entityId };

    // Validate trigger transition against base context
    const machine = machines[init.entity.type];
    if (!machine) {
      return {
        ok: false,
        error: 'validation_failed',
        reason: `No machine found for entity type "${init.entity.type}"`,
      };
    }

    const validation = engine.validate(
      init.entity,
      context,
      machine.rules,
      trigger.targetStatus,
      machine.manualTransitions,
    );

    if (!validation.valid) {
      return { ok: false, error: 'validation_failed', reason: validation.reason };
    }

    const trace = cascade(init, relations, context);

    if (trace.error !== undefined)
      return { ok: false, error: 'cascade_error', partialTrace: trace };

    const changeset: Changeset = {
      changes: [init.triggerChange, ...trace.steps],
      trace,
      unresolved: trace.unresolved,
    };

    return { ok: true, changeset };
  }

  return { simulate, execute };
}
