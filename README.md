# @beomjk/state-engine

Declarative state lifecycle engine for typed entities.

Define transition rules in TypeScript, get compile-time safety and auto-generated spec docs — from the same source of truth.

[![npm version](https://img.shields.io/npm/v/@beomjk/state-engine)](https://www.npmjs.com/package/@beomjk/state-engine)
[![CI](https://github.com/beomjk/state-engine/actions/workflows/ci.yml/badge.svg)](https://github.com/beomjk/state-engine/actions)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@beomjk/state-engine)](https://bundlephobia.com/package/@beomjk/state-engine)
[![coverage](https://img.shields.io/badge/coverage-90%25-brightgreen)]()

## Why?

This library was extracted from [EMDD](https://github.com/beomjk/emdd) (Evolving Mindmap-Driven Development), where knowledge graph nodes — hypotheses, experiments, findings — each follow their own lifecycle with conditions that depend on the graph structure.

Existing state machine libraries either lack compile-time safety for state/transition names, or are too heavy for what is fundamentally a simple evaluation problem. **state-engine** takes a different approach:

- **TypeScript _is_ the config** — `as const` generics catch misspelled statuses and unregistered presets at compile time
- **Named preset registry** — conditions are named functions, not anonymous guards; they're testable, reusable, and show up in generated docs
- **Context injection** — the engine doesn't know about your graph, DB, or API; you inject it via `createEngine<TContext>()`, and presets receive it
- **Pure evaluation** — the engine never mutates state; it only answers "is this transition valid?" and "what can this entity transition to?"
- **Schema → docs** — generate Markdown tables from the same definition object, with AUTO marker replacement to keep spec docs in sync

|                | XState       | machina.js | **state-engine**                       |
| -------------- | ------------ | ---------- | -------------------------------------- |
| Config format  | JS object    | JS object  | **TS-as-Config (type inference)**      |
| Guard style    | Inline funcs | Hooks      | **Named preset registry**              |
| Type safety    | TS support   | Weak       | **`as const` compile-time guarantees** |
| Doc generation | None         | None       | **Schema → Markdown tables**           |
| Bundle size    | ~40 KB       | ~15 KB     | **< 5 KB (zero deps)**                 |
| Complexity     | Statecharts  | Medium     | **Intentionally flat FSM**             |

## Install

```bash
npm install @beomjk/state-engine
```

Requires TypeScript 5.0+ and Node 20+. Zero runtime dependencies.

> **Note:** `Entity` requires `status: string`. If your domain objects have optional status (e.g., newly created nodes), narrow the type before passing to the engine — entities without a status are not valid state machine participants.

## Quick Start

### 1. Define an entity lifecycle

```typescript
import {
  createDefiner,
  defineSchema,
  extractRules,
  extractManualTransitions,
} from '@beomjk/state-engine/schema';
import type { BuiltinPresetArgsMap } from '@beomjk/state-engine/presets';

// Create a type-safe definer with your preset names
const define = createDefiner([
  'field_present',
  'field_equals',
] as const).withArgs<BuiltinPresetArgsMap>();

const hypothesis = define.entity({
  name: 'Hypothesis',
  statuses: ['PROPOSED', 'TESTING', 'SUPPORTED', 'REFUTED', 'DEFERRED'] as const,
  transitions: [
    {
      from: 'PROPOSED',
      to: 'TESTING',
      conditions: [{ fn: 'field_present', args: { name: 'kill_criteria' } }],
    },
    {
      from: 'TESTING',
      to: 'SUPPORTED',
      conditions: [{ fn: 'field_equals', args: { name: 'result', value: 'pass' } }],
    },
    {
      from: 'TESTING',
      to: 'REFUTED',
      conditions: [{ fn: 'field_equals', args: { name: 'result', value: 'fail' } }],
    },
  ],
  // Manual transitions bypass conditions — users can always defer
  manualTransitions: [{ from: 'ANY', to: 'DEFERRED' }],
});
```

Misspell a status? TypeScript catches it:

```typescript
// @ts-expect-error — 'TETSING' is not in the statuses tuple
{ from: 'PROPOSED', to: 'TETSING', conditions: [] }
```

### 2. Evaluate transitions

```typescript
import { createEngine } from '@beomjk/state-engine/engine';
import { builtinPresets } from '@beomjk/state-engine/presets';

const engine = createEngine({ presets: builtinPresets });
const rules = extractRules(hypothesis);
const manual = extractManualTransitions(hypothesis);

const entity = {
  id: 'h-1',
  type: 'hypothesis',
  status: 'PROPOSED',
  meta: { kill_criteria: 'Disproved if error rate > 5%' },
};

// What can this entity transition to? (auto + manual)
const targets = engine.getValidTransitions(entity, {}, rules, manual);
// → [
//   { status: 'TESTING', rule: { from: 'PROPOSED', to: 'TESTING', ... }, matchedIds: [] },
//   { status: 'DEFERRED', rule: null, matchedIds: [] },
// ]

// Is a specific transition allowed?
const result = engine.validate(entity, {}, rules, 'TESTING', manual);
// → { valid: true, rule: { from: 'PROPOSED', to: 'TESTING', ... }, matchedIds: [] }
```

### 3. Inject context for graph-aware conditions

The real power shows when conditions need external context — a graph, a database, an API client:

```typescript
import type { Entity, PresetFn } from '@beomjk/state-engine';

// Your domain context
interface Graph {
  getLinkedNodes(id: string, relation: string): Entity[];
}

// A preset that queries the graph
const has_supporting_evidence: PresetFn<Graph, { min: number }> = (entity, graph, args) => {
  const findings = graph.getLinkedNodes(entity.id, 'SUPPORTS');
  return {
    met: findings.length >= args.min,
    matchedIds: findings.map((f) => f.id),
  };
};

const engine = createEngine<Graph>({
  presets: {
    ...builtinPresets,
    has_supporting_evidence,
  },
});

// Now transitions can depend on graph structure
const entity = { id: 'h-1', type: 'hypothesis', status: 'TESTING', meta: {} };
const graph: Graph = {
  /* ... */
};

engine.getValidTransitions(entity, graph, rules);
// → matchedIds tells you which findings supported the transition
```

`matchedIds` provides transparency: you know not just _whether_ a transition is valid, but _which related entities_ made it valid.

### 4. Generate spec docs from the schema

```typescript
import { generateDocs, updateDocContent } from '@beomjk/state-engine/schema';

const schema = defineSchema({
  presetNames: ['field_present', 'field_equals'] as const,
  entities: { hypothesis },
});

// Generate Markdown tables
const docs = generateDocs(schema);
console.log(docs.transitions);
```

Output:

```markdown
**Hypothesis**
| From | To | Conditions |
|------|----|------------|
| PROPOSED | TESTING | field_present(name=kill_criteria) |
| TESTING | SUPPORTED | field_equals(name=result, value=pass) |
| TESTING | REFUTED | field_equals(name=result, value=fail) |
```

Keep your spec docs in sync with AUTO markers:

```markdown
## Transition Rules

<!-- AUTO:transitions -->

This content is auto-replaced by updateDocContent()

<!-- /AUTO:transitions -->
```

```typescript
const { content, updated } = updateDocContent(markdown, schema);
// Replaces the region between markers with fresh tables
```

### 5. Generate state diagrams

```typescript
import { generateMermaid } from '@beomjk/state-engine/schema';

console.log(generateMermaid(hypothesis));
```

Output (renders natively on GitHub):

```mermaid
stateDiagram-v2
    [*] --> PROPOSED
    PROPOSED --> TESTING: field_present(name=kill_criteria)
    TESTING --> SUPPORTED: field_equals(name=result, value=pass)
    TESTING --> REFUTED: field_equals(name=result, value=fail)
    PROPOSED --> DEFERRED: manual
    TESTING --> DEFERRED: manual
    SUPPORTED --> DEFERRED: manual
    REFUTED --> DEFERRED: manual
```

## API Overview

### Entry Points

| Import path                    | Exports                                                         |
| ------------------------------ | --------------------------------------------------------------- |
| `@beomjk/state-engine`         | Everything below                                                |
| `@beomjk/state-engine/engine`  | `createEngine`, engine types                                    |
| `@beomjk/state-engine/schema`  | `createDefiner`, `defineSchema`, `extractRules`, `generateDocs` |
| `@beomjk/state-engine/presets` | `builtinPresets`, preset arg types                              |

### Engine

```typescript
const engine = createEngine<TContext>(options);

engine.evaluate(entity, context, rule);
// → { met: boolean, matchedIds: string[] }

engine.getValidTransitions(entity, context, rules, manualTransitions?);
// → ValidTransition[]  (auto rules + manual transitions with rule: null)

engine.validate(entity, context, rules, targetStatus, manualTransitions?);
// → { valid: true, rule, matchedIds } | { valid: false, reason, matchedIds }
```

### Schema

```typescript
// Type-safe builder (recommended)
const define = createDefiner(presetNames).withArgs<ArgsMap>();
const entity = define.entity({ name, statuses, transitions, manualTransitions });

// Group entities into a schema
const schema = defineSchema({ presetNames, entities, policy? });

// Bridge to engine
const rules = extractRules(entity);         // → TransitionRule[]
const manual = extractManualTransitions(entity); // → ManualTransition[]

// Docs
const docs = generateDocs(schema, { tables: ['statuses', 'transitions'] });
const { content, updated } = updateDocContent(markdown, schema);
const mermaid = generateMermaid(entity);  // → Mermaid stateDiagram-v2 string
```

### Built-in Presets

| Preset          | Args               | Behavior                                                                  |
| --------------- | ------------------ | ------------------------------------------------------------------------- |
| `field_present` | `{ name: string }` | Passes if `meta[name]` is non-null, non-empty string, and non-empty array |
| `field_equals`  | `{ name, value }`  | Passes if `meta[name] === value` (strict equality — `"5" !== 5`)          |

`field_present` treats `null`, `undefined`, `""`, and `[]` as absent. Note that `0`, `false`, and non-empty arrays are considered present.

### Writing Custom Presets

A preset is a function that receives the entity, your injected context, and typed arguments:

```typescript
const my_preset: PresetFn<MyContext, MyArgs> = (entity, context, args) => ({
  met: /* your logic */,
  matchedIds: /* related entity IDs, or [] */,
});
```

`Entity` is a minimal interface (`id`, `type`, `status`, `meta`). If your domain objects carry additional fields (e.g., `links`, `tags`), retrieve them from the context:

```typescript
// Entity doesn't have links — look up the full domain object from context
const has_linked: PresetFn<Graph, { type: string }> = (entity, graph, args) => {
  const node = graph.nodes.get(entity.id);
  if (!node) return { met: false, matchedIds: [] };
  const linked = node.links.filter((l) => l.type === args.type);
  return { met: linked.length > 0, matchedIds: linked.map((l) => l.target) };
};
```

## Design Decisions

- **AND-only conditions** — all conditions in a rule must pass. If you need OR, model it as separate rules with the same `from → to`.
- **Three-layer validation** — `validate()` checks auto rules first, falls back to manual transitions, then returns an error. This matches the pattern where most transitions are condition-driven but some are user-initiated overrides.
- **`matchedIds` in every result** — designed for graph contexts where you need to know which related entities contributed to a transition decision.

## Error Handling

The engine returns result objects instead of throwing — except for one case:

- **`UnknownPresetError`** — thrown when a condition references a preset name not registered in `createEngine({ presets })`. The error message includes the unknown name and all registered preset names:
  ```
  Unknown preset function: "has_linkd". Registered presets: field_present, field_equals
  ```

All other failures are expressed through return values (`{ met: false }`, `{ valid: false, reason }`).

## License

MIT
