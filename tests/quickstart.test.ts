import { describe, it, expect } from 'vitest';
import { createEngine, builtinPresets } from '../src/index.js';
import { createDefiner, defineSchema, extractRules, extractManualTransitions } from '../src/schema/index.js';
import { generateDocs, updateDocContent } from '../src/schema/index.js';
import type { BuiltinPresetArgsMap } from '../src/presets/index.js';

describe('quickstart: Basic Usage (Engine Only)', () => {
  it('evaluates a simple transition', () => {
    const engine = createEngine({ presets: builtinPresets });

    const rule = {
      from: 'PROPOSED',
      to: 'TESTING',
      conditions: [{ fn: 'field_present', args: { name: 'assignee' } }],
    };

    const entity = { id: '1', type: 'hypothesis', status: 'PROPOSED', meta: { assignee: 'Alice' } };
    const result = engine.evaluate(entity, {}, rule);

    expect(result).toEqual({ met: true, matchedIds: [] });
  });
});

describe('quickstart: Type-Safe Schema Definition', () => {
  it('defines entity with type-safe presets and validates transitions', () => {
    const define = createDefiner(['field_present', 'field_equals'] as const)
      .withArgs<BuiltinPresetArgsMap>();

    const hypothesis = define.entity({
      name: 'Hypothesis',
      statuses: ['PROPOSED', 'TESTING', 'VALIDATED', 'REJECTED', 'DEFERRED'] as const,
      transitions: [
        {
          from: 'PROPOSED',
          to: 'TESTING',
          conditions: [{ fn: 'field_present', args: { name: 'assignee' } }],
        },
        {
          from: 'TESTING',
          to: 'VALIDATED',
          conditions: [{ fn: 'field_equals', args: { name: 'result', value: 'pass' } }],
        },
      ],
      manualTransitions: [{ from: 'ANY', to: 'DEFERRED' }],
    });

    const rules = extractRules(hypothesis);
    const manual = extractManualTransitions(hypothesis);

    const engine = createEngine({ presets: builtinPresets });
    const entity = { id: '1', type: 'hypothesis', status: 'PROPOSED', meta: { assignee: 'Bob' } };

    const validation = engine.validate(entity, {}, rules, 'TESTING', manual);
    expect(validation.valid).toBe(true);
    if (validation.valid) {
      expect(validation.rule).toBeTruthy();
      expect(validation.matchedIds).toEqual([]);
    }

    const targets = engine.getValidTransitions(entity, {}, rules);
    expect(targets).toHaveLength(1);
    expect(targets[0].status).toBe('TESTING');
  });
});

describe('quickstart: Documentation Generation', () => {
  it('generates docs and replaces AUTO markers', () => {
    const define = createDefiner(['field_present'] as const)
      .withArgs<{ field_present: { name: string } }>();

    const hypothesis = define.entity({
      name: 'Hypothesis',
      statuses: ['PROPOSED', 'TESTING'] as const,
      transitions: [
        {
          from: 'PROPOSED',
          to: 'TESTING',
          conditions: [{ fn: 'field_present', args: { name: 'assignee' } }],
        },
      ],
    });

    const schema = defineSchema({
      presetNames: ['field_present'] as const,
      entities: { hypothesis },
    });

    const docs = generateDocs(schema, { tables: ['transitions'] });
    expect(docs.transitions).toContain('field_present(name=assignee)');

    const markdown = `
# States
<!-- AUTO:transitions -->
old content
<!-- /AUTO:transitions -->
`;
    const { content, updated, tablesReplaced } = updateDocContent(markdown, schema);
    expect(updated).toBe(true);
    expect(tablesReplaced).toContain('transitions');
    expect(content).toContain('field_present(name=assignee)');
  });
});
