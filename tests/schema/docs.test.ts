import { describe, it, expect } from 'vitest';
import { generateDocs, generateMermaid, updateDocContent } from '../../src/schema/docs.js';
import { createDefiner, defineSchema } from '../../src/schema/define.js';
import type { BuiltinPresetArgsMap } from '../../src/presets/builtins.js';

const presetNames = ['field_present', 'field_equals'] as const;
const define = createDefiner(presetNames).withArgs<BuiltinPresetArgsMap>();

function makeSchema() {
  const hypothesis = define.entity({
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
    expect(docs.transitions).toContain(
      '| TESTING | VALIDATED | field_equals(name=result, value=pass) |',
    );
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
    const entity = define.entity({
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
  it('replaces AUTO markers and returns updated content', () => {
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
    expect(result.content).toContain('| PROPOSED |');
    expect(result.content).toContain('field_present(name=assignee)');
    expect(result.content).not.toContain('old content here');
    expect(result.content).not.toContain('old transitions');
  });

  it('returns original content unchanged when no markers found', () => {
    const schema = makeSchema();
    const content = '# No markers here\nJust plain text.';

    const result = updateDocContent(content, schema);

    expect(result.updated).toBe(false);
    expect(result.tablesReplaced).toEqual([]);
    expect(result.content).toBe(content);
  });

  it('preserves content outside markers', () => {
    const schema = makeSchema();
    const content = `Header
<!-- AUTO:statuses -->
old
<!-- /AUTO:statuses -->
Footer`;

    const result = updateDocContent(content, schema);

    expect(result.updated).toBe(true);
    expect(result.content).toContain('Header');
    expect(result.content).toContain('Footer');
    expect(result.content).toContain('| PROPOSED |');
    expect(result.content).not.toContain('\nold\n');
  });
});

describe('generateMermaid', () => {
  it('generates stateDiagram-v2 with initial state and auto transitions', () => {
    const entity = define.entity({
      name: 'Hypothesis',
      statuses: ['PROPOSED', 'TESTING', 'VALIDATED'] as const,
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
    });

    const result = generateMermaid(entity);

    expect(result).toContain('stateDiagram-v2');
    expect(result).toContain('[*] --> PROPOSED');
    expect(result).toContain('PROPOSED --> TESTING: field_present(name=assignee)');
    expect(result).toContain('TESTING --> VALIDATED: field_equals(name=result, value=pass)');
  });

  it('expands ANY wildcard to all statuses except the target', () => {
    const entity = define.entity({
      name: 'Task',
      statuses: ['OPEN', 'IN_PROGRESS', 'DEFERRED'] as const,
      manualTransitions: [{ from: 'ANY', to: 'DEFERRED' }],
    });

    const result = generateMermaid(entity);

    expect(result).toContain('OPEN --> DEFERRED: manual');
    expect(result).toContain('IN_PROGRESS --> DEFERRED: manual');
    // No self-loop DEFERRED → DEFERRED
    expect(result).not.toContain('DEFERRED --> DEFERRED');
  });

  it('shows specific manual transitions without expansion', () => {
    const entity = define.entity({
      name: 'Item',
      statuses: ['A', 'B', 'C'] as const,
      manualTransitions: [{ from: 'A', to: 'C' }],
    });

    const result = generateMermaid(entity);

    expect(result).toContain('A --> C: manual');
    // Only A→C, not B→C
    expect(result).not.toContain('B --> C');
  });

  it('handles entity with no transitions', () => {
    const entity = define.entity({
      name: 'Simple',
      statuses: ['ONLY'] as const,
    });

    const result = generateMermaid(entity);

    expect(result).toBe('stateDiagram-v2\n    [*] --> ONLY');
  });

  it('joins multiple conditions with AND', () => {
    const entity = define.entity({
      name: 'Multi',
      statuses: ['A', 'B'] as const,
      transitions: [
        {
          from: 'A',
          to: 'B',
          conditions: [
            { fn: 'field_present', args: { name: 'x' } },
            { fn: 'field_equals', args: { name: 'y', value: 'z' } },
          ],
        },
      ],
    });

    const result = generateMermaid(entity);

    expect(result).toContain('A --> B: field_present(name=x) AND field_equals(name=y, value=z)');
  });

  it('renders unlabeled transition when conditions are empty', () => {
    const entity = define.entity({
      name: 'Auto',
      statuses: ['A', 'B'] as const,
      transitions: [{ from: 'A', to: 'B' }],
    });

    const result = generateMermaid(entity);

    expect(result).toContain('A --> B');
    // No trailing colon
    expect(result).not.toContain('A --> B:');
  });

  it('includes both auto and manual transitions', () => {
    const schema = makeSchema();
    const entity = schema.entities.hypothesis;
    const result = generateMermaid(entity);

    // Auto
    expect(result).toContain('PROPOSED --> TESTING: field_present(name=assignee)');
    // Manual (ANY → REJECTED expands to 3 edges, excluding REJECTED itself)
    expect(result).toContain('PROPOSED --> REJECTED: manual');
    expect(result).toContain('TESTING --> REJECTED: manual');
    expect(result).toContain('VALIDATED --> REJECTED: manual');
    expect(result).not.toContain('REJECTED --> REJECTED');
  });
});

describe('generateDocs — relations', () => {
  it('generates relations table', () => {
    const d = createDefiner(presetNames).withArgs<BuiltinPresetArgsMap>();
    const entityA = d.entity({ name: 'Experiment', statuses: ['A'] as const });
    const entityB = d.entity({ name: 'Hypothesis', statuses: ['B'] as const });
    d.relation({
      name: 'tests',
      source: 'experiment',
      target: 'hypothesis',
      metadata: { classification: 'conducts' },
    });
    const schema = defineSchema({
      presetNames,
      entities: { experiment: entityA, hypothesis: entityB },
      relations: d.getRelations(),
    });

    const docs = generateDocs(schema, { tables: ['relations'] });

    expect(docs.relations).toContain('| Relation | Source | Target | Direction | Metadata |');
    expect(docs.relations).toContain('| tests | experiment | hypothesis | default |');
    expect(docs.relations).toContain('"classification":"conducts"');
  });

  it('direction defaults to "default" in output', () => {
    const d = createDefiner([] as const);
    const entity = d.entity({ name: 'A', statuses: ['X'] as const });
    d.relation({ name: 'link', source: 'a', target: 'a' });
    const schema = defineSchema({
      presetNames: [] as const,
      entities: { a: entity },
      relations: d.getRelations(),
    });

    const docs = generateDocs(schema, { tables: ['relations'] });
    expect(docs.relations).toContain('| default |');
  });

  it('shows reverse direction', () => {
    const d = createDefiner([] as const);
    const entity = d.entity({ name: 'A', statuses: ['X'] as const });
    d.relation({ name: 'depends', source: 'a', target: 'a', direction: 'reverse' });
    const schema = defineSchema({
      presetNames: [] as const,
      entities: { a: entity },
      relations: d.getRelations(),
    });

    const docs = generateDocs(schema, { tables: ['relations'] });
    expect(docs.relations).toContain('| reverse |');
  });

  it('shows em-dash for missing metadata', () => {
    const d = createDefiner([] as const);
    const entity = d.entity({ name: 'A', statuses: ['X'] as const });
    d.relation({ name: 'link', source: 'a', target: 'a' });
    const schema = defineSchema({
      presetNames: [] as const,
      entities: { a: entity },
      relations: d.getRelations(),
    });

    const docs = generateDocs(schema, { tables: ['relations'] });
    expect(docs.relations).toContain('| \u2014 |');
  });

  it('schema with no relations — empty relations table', () => {
    const schema = makeSchema();
    const docs = generateDocs(schema, { tables: ['relations'] });
    expect(docs.relations).toBe('');
  });

  it('relations included in default tables', () => {
    const d = createDefiner(presetNames).withArgs<BuiltinPresetArgsMap>();
    const entity = d.entity({ name: 'A', statuses: ['X'] as const });
    d.relation({ name: 'link', source: 'a', target: 'a' });
    const schema = defineSchema({
      presetNames,
      entities: { a: entity },
      relations: d.getRelations(),
    });

    const docs = generateDocs(schema);
    expect(docs).toHaveProperty('relations');
    expect(docs.relations).toContain('| link |');
  });
});

describe('scale test (SC-003)', () => {
  it('handles 5 entities with 20 transition rules', () => {
    const statuses = ['S1', 'S2', 'S3', 'S4', 'S5'] as const;
    const entities: Record<string, ReturnType<typeof define.entity>> = {};

    for (let i = 0; i < 5; i++) {
      entities[`entity_${i}`] = define.entity({
        name: `Entity${i}`,
        statuses,
        transitions: [
          {
            from: 'S1',
            to: 'S2',
            conditions: [{ fn: 'field_present', args: { name: `f${i}_a` } }],
          },
          {
            from: 'S2',
            to: 'S3',
            conditions: [{ fn: 'field_equals', args: { name: `f${i}_b`, value: 'yes' } }],
          },
          {
            from: 'S3',
            to: 'S4',
            conditions: [{ fn: 'field_present', args: { name: `f${i}_c` } }],
          },
          {
            from: 'S4',
            to: 'S5',
            conditions: [{ fn: 'field_equals', args: { name: `f${i}_d`, value: 'done' } }],
          },
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
