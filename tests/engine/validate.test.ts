import { describe, it, expect } from 'vitest';
import { createEngine } from '../../src/engine/engine.js';
import type { Entity, TransitionRule, ManualTransition } from '../../src/engine/types.js';

describe('engine.validate', () => {
  it.todo('auto transition success');
  it.todo('auto transition failure');
  it.todo('manual transition fallback');
  it.todo('ANY wildcard in manual transition');
  it.todo('both auto and manual fail');
});
