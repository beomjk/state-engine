// Engine
export { createEngine } from './engine/index.js';
export type {
  Engine,
  EngineOptions,
  Entity,
  EvaluationResult,
  ManualTransition,
  PresetFn,
  PresetResult,
  TransitionCondition,
  TransitionRule,
  ValidationResult,
} from './engine/index.js';
export { InvalidTransitionError, UnknownPresetError } from './engine/index.js';

// Schema
export {
  defineEntity,
  defineSchema,
  extractManualTransitions,
  extractRules,
} from './schema/index.js';
export type { EntityDefinition, SchemaDefinition } from './schema/index.js';
export { generateDocs, updateDocContent } from './schema/index.js';
export type { DocGeneratorOptions } from './schema/index.js';

// Presets
export { builtinPresets } from './presets/index.js';
