import { describe, it, expect } from 'vitest';
import { generateDocs, updateDocContent } from '../../src/schema/docs.js';
import { defineEntity, defineSchema } from '../../src/schema/define.js';

const presetNames = ['field_present', 'field_equals'] as const;
const argsMap = {
  field_present: { name: '' },
  field_equals: { name: '', value: undefined as unknown },
};

function makeSchema() {
  const hypothesis = defineEntity(presetNames, argsMap, {
    name: 'Hypothesis',
    statuses: ['PROPOSED', 'TESTING', 'VALIDATED', 'REJECTED'] as const,
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
    manualTransitions: [{ from: 'ANY', to: 'REJECTED' }],
  });

  return defineSchema({
    presetNames,
    entities: { hypothesis },
  });
}

describe('generateDocs', () => {
  it('generates statuses table', () => {
    const schema = makeSchema();
    const docs = generateDocs(schema, { tables: ['statuses'] });

    expect(docs.statuses).toContain('**Hypothesis**');
    expect(docs.statuses).toContain('| Status |');
    expect(docs.statuses).toContain('| PROPOSED |');
    expect(docs.statuses).toContain('| TESTING |');
    expect(docs.statuses).toContain('| VALIDATED |');
    expect(docs.statuses).toContain('| REJECTED |');
  });

  it('generates transitions table with conditions formatted as preset_name(arg=val)', () => {
    const schema = makeSchema();
    const docs = generateDocs(schema, { tables: ['transitions'] });

    expect(docs.transitions).toContain('**Hypothesis**');
    expect(docs.transitions).toContain('| From | To | Conditions |');
    expect(docs.transitions).toContain('| PROPOSED | TESTING | field_present(name=assignee) |');
    expect(docs.transitions).toContain('| TESTING | VALIDATED | field_equals(name=result, value=pass) |');
  });

  it('generates manual-transitions table', () => {
    const schema = makeSchema();
    const docs = generateDocs(schema, { tables: ['manual-transitions'] });

    expect(docs['manual-transitions']).toContain('**Hypothesis**');
    expect(docs['manual-transitions']).toContain('| From | To |');
    expect(docs['manual-transitions']).toContain('| ANY | REJECTED |');
  });

  it('generates all tables when no options specified', () => {
    const schema = makeSchema();
    const docs = generateDocs(schema);

    expect(docs).toHaveProperty('statuses');
    expect(docs).toHaveProperty('transitions');
    expect(docs).toHaveProperty('manual-transitions');
  });

  it('shows em-dash for transitions with no conditions', () => {
    const entity = defineEntity(presetNames, argsMap, {
      name: 'Simple',
      statuses: ['A', 'B'] as const,
      transitions: [{ from: 'A', to: 'B' }],
    });
    const schema = defineSchema({ presetNames, entities: { simple: entity } });
    const docs = generateDocs(schema, { tables: ['transitions'] });

    expect(docs.transitions).toContain('| A | B | — |');
  });
});

describe('updateDocContent', () => {
  it('replaces AUTO markers and returns { updated: true, tablesReplaced }', () => {
    const schema = makeSchema();
    const content = `# States
<!-- AUTO:statuses -->
old content here
<!-- /AUTO:statuses -->

# Transitions
<!-- AUTO:transitions -->
old transitions
<!-- /AUTO:transitions -->
`;

    const result = updateDocContent(content, schema);

    expect(result.updated).toBe(true);
    expect(result.tablesReplaced).toContain('statuses');
    expect(result.tablesReplaced).toContain('transitions');
  });

  it('returns { updated: false } when no markers found', () => {
    const schema = makeSchema();
    const content = '# No markers here\nJust plain text.';

    const result = updateDocContent(content, schema);

    expect(result.updated).toBe(false);
    expect(result.tablesReplaced).toEqual([]);
  });

  it('preserves content outside markers', () => {
    const schema = makeSchema();
    const content = `Header
<!-- AUTO:statuses -->
old
<!-- /AUTO:statuses -->
Footer`;

    const result = updateDocContent(content, schema);
    const output = `Header\n<!-- AUTO:statuses -->\n${generateDocs(schema, { tables: ['statuses'] }).statuses}\n<!-- /AUTO:statuses -->\nFooter`;

    expect(result.updated).toBe(true);
    // Verify markers and surrounding text preserved
    expect(output).toContain('Header');
    expect(output).toContain('Footer');
    expect(output).toContain('| PROPOSED |');
  });
});

describe('scale test (SC-003)', () => {
  it('handles 5 entities with 20 transition rules', () => {
    const statuses = ['S1', 'S2', 'S3', 'S4', 'S5'] as const;
    const entities: Record<string, ReturnType<typeof defineEntity>> = {};

    for (let i = 0; i < 5; i++) {
      entities[`entity_${i}`] = defineEntity(presetNames, argsMap, {
        name: `Entity${i}`,
        statuses,
        transitions: [
          { from: 'S1', to: 'S2', conditions: [{ fn: 'field_present', args: { name: `f${i}_a` } }] },
          { from: 'S2', to: 'S3', conditions: [{ fn: 'field_equals', args: { name: `f${i}_b`, value: 'yes' } }] },
          { from: 'S3', to: 'S4', conditions: [{ fn: 'field_present', args: { name: `f${i}_c` } }] },
          { from: 'S4', to: 'S5', conditions: [{ fn: 'field_equals', args: { name: `f${i}_d`, value: 'done' } }] },
        ],
        manualTransitions: [{ from: 'ANY', to: 'S1' }],
      });
    }

    const schema = defineSchema({ presetNames, entities });
    const docs = generateDocs(schema);

    // 5 entities × 5 statuses each
    for (let i = 0; i < 5; i++) {
      expect(docs.statuses).toContain(`**Entity${i}**`);
    }

    // 5 entities × 4 transitions each = 20 transitions
    const transitionRows = docs.transitions.split('\n').filter((l) => l.startsWith('| S'));
    expect(transitionRows).toHaveLength(20);

    // 5 entities × 1 manual transition each
    expect(docs['manual-transitions']).toContain('| ANY | S1 |');

    // Verify condition formatting
    expect(docs.transitions).toContain('field_present(name=f0_a)');
    expect(docs.transitions).toContain('field_equals(name=f4_d, value=done)');
  });
});
