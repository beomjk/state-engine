import { describe, it, expect } from 'vitest';

// Entry point: @beomjk/state-engine (root)
import {
  createDefiner,
  createEngine,
  defineEntity,
  defineSchema,
  extractRules,
  extractManualTransitions,
  generateDocs,
  generateMermaid,
  updateDocContent,
  builtinPresets,
  UnknownPresetError,
} from '../src/index.js';
import type {
  Entity,
  EvaluationResult,
  ValidTransition,
  ValidationResult,
  TransitionRule,
  FieldPresentArgs,
} from '../src/index.js';

// Entry point: @beomjk/state-engine/engine
import { createEngine as createEngine2 } from '../src/engine/index.js';

// Entry point: @beomjk/state-engine/schema
import {
  createDefiner as cd2,
  defineEntity as de2,
  extractRules as er2,
} from '../src/schema/index.js';

// Entry point: @beomjk/state-engine/orchestrator
import { createOrchestrator, propagateAll, StateOverlay } from '../src/orchestrator/index.js';
import type {
  CascadeTrace as _CascadeTrace,
  SimulationResult as _SimulationResult,
  Orchestrator as _Orchestrator,
} from '../src/orchestrator/index.js';

// Entry point: @beomjk/state-engine/presets
import { builtinPresets as bp2 } from '../src/presets/index.js';

describe('entry point imports', () => {
  it('root entry exports all public API', () => {
    expect(createDefiner).toBeTypeOf('function');
    expect(createEngine).toBeTypeOf('function');
    expect(defineEntity).toBeTypeOf('function');
    expect(defineSchema).toBeTypeOf('function');
    expect(extractRules).toBeTypeOf('function');
    expect(extractManualTransitions).toBeTypeOf('function');
    expect(generateDocs).toBeTypeOf('function');
    expect(generateMermaid).toBeTypeOf('function');
    expect(updateDocContent).toBeTypeOf('function');
    expect(builtinPresets).toBeTypeOf('object');
    expect(UnknownPresetError).toBeTypeOf('function');
  });

  it('engine entry exports engine API', () => {
    expect(createEngine2).toBeTypeOf('function');
  });

  it('schema entry exports schema API', () => {
    expect(cd2).toBeTypeOf('function');
    expect(de2).toBeTypeOf('function');
    expect(er2).toBeTypeOf('function');
  });

  it('orchestrator entry exports orchestrator API', () => {
    expect(createOrchestrator).toBeTypeOf('function');
    expect(propagateAll).toBeTypeOf('function');
    expect(StateOverlay).toBeTypeOf('function');
  });

  it('presets entry exports presets API', () => {
    expect(bp2).toBeTypeOf('object');
    expect(bp2.field_present).toBeTypeOf('function');
    expect(bp2.field_equals).toBeTypeOf('function');
  });

  it('type inference works with full workflow', () => {
    const engine = createEngine({ presets: builtinPresets });
    const entity: Entity = { id: '1', type: 'h', status: 'A', meta: { x: 1 } };
    const rule: TransitionRule = { from: 'A', to: 'B', conditions: [] };

    const evalResult: EvaluationResult = engine.evaluate(entity, {}, rule);
    expect(evalResult.met).toBe(true);

    const validTransitions: ValidTransition[] = engine.getValidTransitions(entity, {}, [rule]);
    expect(validTransitions).toHaveLength(1);

    const validation: ValidationResult = engine.validate(entity, {}, [rule], 'B');
    expect(validation.valid).toBe(true);
  });

  it('createDefiner type inference catches errors', () => {
    const define = createDefiner(['field_present'] as const).withArgs<{
      field_present: FieldPresentArgs;
    }>();

    const def = define.entity({
      name: 'Test',
      statuses: ['X', 'Y'] as const,
      transitions: [
        {
          from: 'X',
          to: 'Y',
          conditions: [{ fn: 'field_present', args: { name: 'foo' } }],
        },
      ],
    });

    const rules = extractRules(def);
    expect(rules[0].from).toBe('X');
    expect(rules[0].conditions[0].fn).toBe('field_present');
  });
});
