# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build          # tsup → ESM + DTS in dist/
npm test               # vitest run
npm run test:watch     # vitest (watch mode)
npm run test:coverage  # vitest run --coverage (thresholds: 90/90/80/90)
npm run typecheck      # tsc --noEmit
npm run lint           # eslint src/ tests/
npm run format         # prettier --write .
```

Run a single test file:

```bash
npx vitest run tests/engine/evaluate.test.ts
npx vitest run -t "empty conditions"          # by test name
```

## Architecture

TypeScript-first declarative state machine library. Zero runtime dependencies, <10KB.

### Four modules, one public API

```
src/
├── engine/          # Core FSM: createEngine → evaluate / validate / getValidTransitions
│   ├── types.ts     # Entity, PresetFn, TransitionRule, result types, error classes
│   └── engine.ts    # Factory + evaluation logic
├── schema/          # Type-safe definition DSL + doc generation
│   ├── define.ts    # defineEntity, defineSchema, relation declarations (const generics)
│   └── docs.ts      # generateDocs, updateDocContent (AUTO marker replacement)
├── orchestrator/    # Multi-entity cascade: createOrchestrator → simulate / execute
│   ├── types.ts     # CascadeTrace, Changeset, PropagationStrategy, Orchestrator
│   ├── orchestrator.ts  # Factory + BFS cascade logic
│   └── overlay.ts   # StateOverlay — virtual state map for immutable cascade
└── presets/         # Extensible condition registry
    └── builtins.ts  # field_present, field_equals (consumers add domain presets)
```

Consumers import from five entry points: `@beomjk/state-engine`, `./engine`, `./schema`, `./orchestrator`, `./presets`.

### Key patterns

- **Generic context injection**: `createEngine<TContext>()` — TContext is Graph, DB, etc.
- **Preset registry**: Named functions looked up at runtime via `options.presets`
- **AND-only conditions**: All conditions in a rule must pass. No OR/NOT.
- **Const generics**: `defineEntity` uses `const TStatuses` for literal tuple inference — misspelled statuses/presets are caught at compile time
- **Three-layer validation**: auto rules → manual transition fallback → invalid
- **Pure evaluation**: Engine never mutates state, only returns results

### Schema → Engine → Orchestrator bridge

```typescript
const rules = extractRules(schema.entities.hypothesis); // TransitionRule[]
const manual = extractManualTransitions(schema.entities.hypothesis); // ManualTransition[]
engine.validate(entity, ctx, rules, 'TESTING', manual);

// Orchestrator uses engine + schema relations for cascade detection
const orchestrator = createOrchestrator({
  engine,
  machines: { hypothesis: { rules, manualTransitions: manual } },
  relations: extractRelations(schema),
});
const result = orchestrator.simulate(entities, relationInstances, ctx, {
  entityId: 'h1',
  targetStatus: 'TESTING',
});
```

## Conventions

- ESM only: `.js` extensions in all imports (even for `.ts` sources)
- All project artifacts (docs, comments, commit messages, release notes) in English
- Tests: `tests/{engine,schema,presets,orchestrator}/` mirroring `src/` structure

## Active Technologies

- TypeScript 5.7+ (const generics), ESM only, `.js` extensions in imports + Zero runtime dependencies (devDependencies: tsup 8.4, vitest 3.1, eslint 9, prettier 3.5) (002-orchestrator-cascade)

- TypeScript 5.7+ (const generics require TS 5.0+) + Zero runtime; devDependencies: tsup 8.4, vitest 3.1, eslint 9, prettier 3.5 (001-core-engine-mvp)
- N/A (stateless library) (001-core-engine-mvp)

## Recent Changes

- 001-core-engine-mvp: Added TypeScript 5.7+ (const generics require TS 5.0+) + Zero runtime; devDependencies: tsup 8.4, vitest 3.1, eslint 9, prettier 3.5
