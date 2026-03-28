import type { Entity, Engine, TransitionRule, ManualTransition } from '../engine/types.js';

// Re-export for convenience
export type { Entity };

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
  /** True if cascade reached fixed point; false if iteration cap hit */
  converged: boolean;
  /** Total BFS rounds executed */
  rounds: number;
}

/**
 * Result of execute(). Wraps a CascadeTrace with application semantics.
 */
export interface Changeset {
  /** Ordered list of state changes to apply */
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
 */
export type PropagationStrategy = (change: StateChange, relation: RelationInstance) => boolean;

/**
 * Default strategy: propagate across all relations.
 */
export const propagateAll: PropagationStrategy = () => true;

/**
 * Relation definition — declared in schema, describes a named connection between entity types.
 */
export interface RelationDefinition {
  name: string;
  source: string;
  target: string;
  direction?: 'default' | 'reverse';
  metadata?: Record<string, unknown>;
}

/**
 * Runtime relation between two entity instances.
 */
export interface RelationInstance {
  name: string;
  sourceId: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}

/**
 * Configuration for createOrchestrator().
 */
export interface OrchestratorConfig<TContext> {
  engine: Engine<TContext>;
  machines: Record<string, { rules: TransitionRule[]; manualTransitions?: ManualTransition[] }>;
  relations: RelationDefinition[];
  propagation?: PropagationStrategy;
  maxCascadeDepth?: number;
}

/**
 * Public orchestrator interface.
 */
export interface Orchestrator<TContext> {
  simulate(
    entities: Map<string, Entity>,
    relations: RelationInstance[],
    context: TContext,
    trigger: { entityId: string; targetStatus: string },
  ): SimulationResult;

  execute(
    entities: Map<string, Entity>,
    relations: RelationInstance[],
    context: TContext,
    trigger: { entityId: string; targetStatus: string },
  ): ExecutionResult;
}
