import { describe, it, expect } from 'vitest';
import { createEngine } from '../../src/engine/engine.js';
import type { Entity, TransitionRule } from '../../src/engine/types.js';
import { UnknownPresetError } from '../../src/engine/types.js';

describe('engine.evaluate', () => {
  it.todo('empty conditions = always passes');
  it.todo('single condition met');
  it.todo('single condition not met');
  it.todo('multiple AND conditions all met');
  it.todo('multiple AND conditions partial fail');
  it.todo('unknown preset throws UnknownPresetError');
});
