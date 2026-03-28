import type { Entity, Engine, TransitionRule, ManualTransition } from '../engine/types.js';
import type { RelationDefinition, RelationInstance } from '../schema/define.js';

// Re-export schema-canonical relation types for orchestrator consumers
export type { RelationDefinition, RelationInstance };

/**
 * A single state transition event.
 */
export interface StateChange {
  entityId: string;
  entityType: string;
  from: string;
  to: string;
}

/**
 * One step in a cascade trace, extending StateChange with causal information.
 */
export interface CascadeStep extends StateChange {
  /** BFS iteration round (0 = trigger, 1 = first cascade wave, etc.) */
  round: number;
  /** Entity IDs whose changes caused this re-evaluation */
  triggeredBy: string[];
  /** Which auto-transition rule matched */
  rule: TransitionRule;
}

/**
 * An entity where multiple auto-transitions conflicted during cascade.
 */
export interface UnresolvedEntity {
  entityId: string;
  entityType: string;
  /** Status at time of evaluation (unchanged) */
  currentStatus: string;
  /** List of valid target statuses that conflicted */
  conflictingTargets: string[];
  /** Which cascade round the conflict was detected */
  round: number;
}

/**
 * A manual transition that became newly available during cascade.
 */
export interface AvailableManualTransition {
  entityId: string;
  entityType: string;
  from: string;
  to: string;
}

/**
 * Full result of a simulation or cascade computation.
 */
export interface CascadeTrace {
  /** The initial transition that started the cascade */
  trigger: StateChange;
  /** Ordered list of applied auto-transitions (application order) */
  steps: CascadeStep[];
  /** Entities with conflicting auto-transitions */
  unresolved: UnresolvedEntity[];
  /** Manual transitions that became valid during cascade */
  availableManualTransitions: AvailableManualTransition[];
  /** All entity IDs that were re-evaluated (superset of steps + unresolved) */
  affected: string[];
  /** Entity ID -> final status (overlay result) */
  finalStates: ReadonlyMap<string, string>;
  /** True if cascade reached a fixed point (queue drained normally); false if maxDepth exceeded or error occurred */
  converged: boolean;
  /** Highest BFS round reached (0 = no cascade steps executed, 1+ = cascade rounds) */
  rounds: number;
  /** Error message if cascade terminated with an exception */
  error?: string;
}

/**
 * Result of execute(). Wraps a CascadeTrace with application semantics.
 */
export interface Changeset {
  /** Ordered: first element is the trigger (StateChange), rest are cascade steps (CascadeStep extends StateChange) */
  changes: StateChange[];
  /** Full cascade trace for auditability */
  trace: CascadeTrace;
  /** Shortcut to trace.unresolved */
  unresolved: UnresolvedEntity[];
}

/**
 * Discriminated union returned by simulate().
 */
export type SimulationResult =
  | { ok: true; trace: CascadeTrace }
  | { ok: false; error: 'entity_not_found'; entityId: string }
  | { ok: false; error: 'cascade_error'; partialTrace: CascadeTrace };

/**
 * Discriminated union returned by execute().
 */
export type ExecutionResult =
  | { ok: true; changeset: Changeset }
  | { ok: false; error: 'validation_failed'; reason: string }
  | { ok: false; error: 'entity_not_found'; entityId: string }
  | { ok: false; error: 'cascade_error'; partialTrace: CascadeTrace };

/**
 * Consumer-provided function that decides whether to propagate across a specific relation.
 *
 * Note: when a transition's preset returns non-empty `matchedIds`, those IDs are used
 * directly as downstream targets — bypassing both relation definitions and this strategy.
 * This is by design: instance-level targeting (matchedIds) overrides type-level filtering.
 */
export type PropagationStrategy = (change: StateChange, relation: RelationInstance) => boolean;

/**
 * Default strategy: propagate across all relations.
 */
export const propagateAll: PropagationStrategy = () => true;

/**
 * Configuration for createOrchestrator().
 */
export interface OrchestratorConfig<TContext> {
  engine: Engine<TContext>;
  machines: Record<string, { rules: TransitionRule[]; manualTransitions?: ManualTransition[] }>;
  relations: RelationDefinition[];
  /** Filters relation-based propagation. Ignored when a preset returns non-empty matchedIds. */
  propagation?: PropagationStrategy;
  maxCascadeDepth?: number;
}

/**
 * Public orchestrator interface.
 */
export interface Orchestrator<TContext> {
  /**
   * What-if mode: force-applies the trigger status without validation,
   * then runs cascade to explore downstream effects.
   */
  simulate(
    entities: Map<string, Entity>,
    relations: RelationInstance[],
    context: TContext,
    trigger: { entityId: string; targetStatus: string },
  ): SimulationResult;

  /**
   * Validates the trigger transition against the engine first,
   * then runs cascade and returns an applicable changeset.
   */
  execute(
    entities: Map<string, Entity>,
    relations: RelationInstance[],
    context: TContext,
    trigger: { entityId: string; targetStatus: string },
  ): ExecutionResult;
}
