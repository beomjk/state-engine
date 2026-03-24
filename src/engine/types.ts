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
 * Returned by getValidTransitions() (FR-017).
 */
export interface ValidTransition {
  status: string;
  rule: TransitionRule;
  matchedIds: string[];
}

/**
 * Result of engine.validate(). Discriminated union on `valid` field (FR-019).
 */
export type ValidationResult =
  | {
      valid: true;
      /** Matched auto rule, or null for manual transitions */
      rule: TransitionRule | null;
      matchedIds: string[];
    }
  | {
      valid: false;
      reason: string;
      matchedIds: string[];
    };

/**
 * Engine interface for evaluating state transitions.
 */
export interface Engine<TContext> {
  /** Evaluate a single rule. All conditions must be met. */
  evaluate(entity: Entity, context: TContext, rule: TransitionRule): EvaluationResult;

  /**
   * Return all reachable target statuses via automatic transitions (FR-017).
   * Manual transitions are excluded by design (DD-1): they have no conditions
   * to evaluate, so consumers should union these results with their manual
   * transitions filtered by current status or 'ANY'.
   *
   * Note: if multiple rules share the same `to` status with different conditions,
   * each passing rule produces a separate entry. Map to `status` and deduplicate
   * if you only need unique target statuses.
   */
  getValidTransitions(entity: Entity, context: TContext, rules: TransitionRule[]): ValidTransition[];

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- type erasure for heterogeneous preset args
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

