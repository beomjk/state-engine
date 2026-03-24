import { describe, it, expect } from 'vitest';
import { builtinPresets } from '../../src/presets/builtins.js';
import type { Entity } from '../../src/engine/types.js';

describe('builtinPresets', () => {
  it.todo('field_present: met when field exists');
  it.todo('field_present: not met when null/undefined');
  it.todo('field_present: not met when empty string');
  it.todo('field_present: not met when empty array');
  it.todo('field_equals: met when value matches');
  it.todo('field_equals: not met when value differs');
  it.todo('field_equals: not met on type mismatch');
});
