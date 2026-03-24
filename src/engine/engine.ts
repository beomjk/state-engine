import type {
  Engine,
  EngineOptions,
  Entity,
  EvaluationResult,
  ManualTransition,
  TransitionRule,
  ValidationResult,
} from './types.js';
import { UnknownPresetError } from './types.js';

export function createEngine<TContext>(options: EngineOptions<TContext>): Engine<TContext> {
  const { presets } = options;
  const registeredNames = Object.keys(presets);

  function evaluate(
    entity: Entity,
    context: TContext,
    rule: TransitionRule,
  ): EvaluationResult {
    const allMatchedIds: string[] = [];

    for (const condition of rule.conditions) {
      const presetFn = presets[condition.fn];
      if (!presetFn) {
        throw new UnknownPresetError(condition.fn, registeredNames);
      }

      const result = presetFn(entity, context, condition.args);
      if (!result.met) {
        return { met: false, matchedIds: [] };
      }
      allMatchedIds.push(...result.matchedIds);
    }

    // Empty conditions = always passes
    return { met: true, matchedIds: allMatchedIds };
  }

  function getValidTransitions(
    entity: Entity,
    context: TContext,
    rules: TransitionRule[],
  ): string[] {
    const targets: string[] = [];

    for (const rule of rules) {
      if (rule.from !== entity.status) continue;
      const result = evaluate(entity, context, rule);
      if (result.met) {
        targets.push(rule.to);
      }
    }

    return targets;
  }

  function validate(
    entity: Entity,
    context: TContext,
    rules: TransitionRule[],
    targetStatus: string,
    manualTransitions?: ManualTransition[],
  ): ValidationResult {
    // Check automatic transitions first
    for (const rule of rules) {
      if (rule.from !== entity.status || rule.to !== targetStatus) continue;
      const result = evaluate(entity, context, rule);
      if (result.met) {
        return { valid: true, matchedIds: result.matchedIds };
      }
    }

    // Fallback to manual transitions
    if (manualTransitions) {
      for (const mt of manualTransitions) {
        if (mt.to !== targetStatus) continue;
        if (mt.from === 'ANY' || mt.from === entity.status) {
          return { valid: true, matchedIds: [] };
        }
      }
    }

    return {
      valid: false,
      reason: `No valid transition from "${entity.status}" to "${targetStatus}"`,
      matchedIds: [],
    };
  }

  return { evaluate, getValidTransitions, validate };
}
