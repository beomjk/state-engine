import { describe, it, expect } from 'vitest';
import { createEngine } from '../../src/engine/engine.js';
import type { Entity, TransitionRule } from '../../src/engine/types.js';

describe('engine.getValidTransitions', () => {
  it.todo('returns reachable targets from current status');
  it.todo('returns empty for no matching rules');
});
