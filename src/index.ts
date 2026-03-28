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
  ValidTransition,
  ValidationResult,
} from './engine/index.js';
export { UnknownPresetError } from './engine/index.js';

// Schema
export {
  createDefiner,
  defineEntity,
  defineSchema,
  extractManualTransitions,
  extractRelations,
  extractRules,
} from './schema/index.js';
export type {
  Definer,
  DefinerWithoutArgs,
  EntityDefinition,
  PresetArgsMap,
  RelationDefinition,
  RelationInstance,
  SchemaDefinition,
} from './schema/index.js';
export { generateDocs, generateMermaid, updateDocContent } from './schema/index.js';
export type { DocGeneratorOptions } from './schema/index.js';

// Presets
export { builtinPresets } from './presets/index.js';
export type { BuiltinPresetArgsMap, FieldEqualsArgs, FieldPresentArgs } from './presets/index.js';
