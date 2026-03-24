/**
 * Minimal entity interface for state machine evaluation.
 * Domain objects (e.g., EMDD Node) extend this.
 */
export interface Entity {
  readonly id: string;
  readonly type: string;
  readonly status: string;
  readonly meta: Record<string, unknown>;
}

/**
 * Result of a preset condition evaluation.
 */
export interface PresetResult {
  met: boolean;
  /** IDs of related entities that satisfied the condition (for debugging/transparency). */
  matchedIds: string[];
}

/**
 * A condition function registered in the preset registry.
 * TContext is injected by the consumer (e.g., Graph, DB connection).
 * TArgs allows type-safe arguments per preset.
 */
export type PresetFn<TContext = unknown, TArgs extends Record<string, unknown> = Record<string, unknown>> = (
  entity: Entity,
  context: TContext,
  args: TArgs,
) => PresetResult;

/**
 * A condition within a transition rule.
 */
export interface TransitionCondition {
  /** Preset name (looked up in registry). */
  fn: string;
  /** Arguments passed to the preset. */
  args: Record<string, unknown>;
}

/**
 * An automatic transition rule with conditions.
 */
export interface TransitionRule {
  from: string;
  to: string;
  /** AND conditions — all must be met for transition. */
  conditions: TransitionCondition[];
}

/**
 * A manual (user-triggered) transition. 'ANY' wildcard supported for `from`.
 */
export interface ManualTransition {
  from: string;
  to: string;
}

/**
 * Result of engine.evaluate().
 */
export interface EvaluationResult {
  met: boolean;
  matchedIds: string[];
}

/**
 * Result of engine.validate().
 */
export interface ValidationResult {
  valid: boolean;
  reason?: string;
  matchedIds: string[];
}

/**
 * Engine interface for evaluating state transitions.
 */
export interface Engine<TContext> {
  /** Evaluate a single rule. All conditions must be met. */
  evaluate(entity: Entity, context: TContext, rule: TransitionRule): EvaluationResult;

  /** Return all reachable target statuses via automatic transitions. */
  getValidTransitions(entity: Entity, context: TContext, rules: TransitionRule[]): string[];

  /** Validate whether a specific transition is allowed (auto then manual fallback). */
  validate(
    entity: Entity,
    context: TContext,
    rules: TransitionRule[],
    targetStatus: string,
    manualTransitions?: ManualTransition[],
  ): ValidationResult;
}

/**
 * Options for createEngine().
 */
export interface EngineOptions<TContext> {
  presets: Record<string, PresetFn<TContext, any>>;
}

/**
 * Thrown when a preset name is not found in the registry.
 */
export class UnknownPresetError extends Error {
  constructor(
    public readonly presetName: string,
    registeredNames: string[],
  ) {
    super(
      `Unknown preset function: "${presetName}". Registered presets: ${registeredNames.join(', ')}`,
    );
    this.name = 'UnknownPresetError';
  }
}

/**
 * Thrown when an invalid transition is attempted.
 */
export class InvalidTransitionError extends Error {
  constructor(
    public readonly entityId: string,
    public readonly from: string,
    public readonly to: string,
    public readonly reason: string,
  ) {
    super(`Invalid transition for ${entityId}: ${from} → ${to}. ${reason}`);
    this.name = 'InvalidTransitionError';
  }
}
