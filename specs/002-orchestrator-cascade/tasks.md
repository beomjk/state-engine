# Tasks: Orchestrator — Cascade Detection, Simulation & Execution

**Input**: Design documents from `/specs/002-orchestrator-cascade/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: TDD approach — write tests FIRST (RED), then implement to make them pass (GREEN).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Orchestrator module scaffolding, types, build configuration, and StateOverlay (TDD)

- [x] T001 Define all orchestrator types (StateChange, CascadeStep, CascadeTrace, UnresolvedEntity, AvailableManualTransition, Changeset, SimulationResult, ExecutionResult, PropagationStrategy, OrchestratorConfig, Orchestrator interface) in src/orchestrator/types.ts per data-model.md
- [x] T002 [P] Add orchestrator entry point to tsup.config.ts (add 'orchestrator/index': 'src/orchestrator/index.ts') and package.json exports (add "./orchestrator" with import + types)
- [x] T003 [P] Create src/orchestrator/index.ts barrel file with placeholder exports (to be filled as modules are implemented)
- [x] T004 [P] Create shared test fixtures (sample entity definitions for hypothesis/experiment, sample TransitionRules, sample RelationDefinitions, sample RelationInstances, helper to build entity maps) in tests/orchestrator/fixtures.ts
- [x] T005 [P] Write StateOverlay unit tests (get with/without override, set only writes overlay, base map immutability, snapshot returns correct final states) in tests/orchestrator/overlay.test.ts — tests MUST fail (RED)
- [x] T006 Implement StateOverlay class (immutable base Map + override Map, get() with overlay-first lookup, set() that writes to overlay only, snapshot() for finalStates) in src/orchestrator/overlay.ts — tests MUST pass (GREEN)

**Checkpoint**: Build compiles with new module structure. Types are importable. StateOverlay tested and working.

---

## Phase 2: Schema Relations — US2 (Priority: P1, Foundational)

**Goal**: Consumers can declare named, directional relations between entity types in the schema

**Independent Test**: Define a schema with relations, extract them, verify types and backward compatibility

**CRITICAL**: This phase MUST complete before US1 (simulate) can begin — the orchestrator needs relation declarations

### Tests (RED)

- [x] T007 [US2] Write tests for relation definition (define.relation() accumulates, getRelations() returns, extractRelations() extracts from schema, direction defaults to 'default', metadata is opaque, duplicate relation name throws, invalid source/target entity type throws) in tests/schema/define.test.ts — tests MUST fail (RED)

### Implementation (GREEN)

- [x] T008 [US2] Add RelationDefinition type (name, source, target, direction?, metadata?) and RelationInstance type (name, sourceId, targetId, metadata?) to src/schema/define.ts per data-model.md
- [x] T009 [US2] Extend createDefiner() to return objects with relation() and getRelations() methods — relation() accumulates into internal array, getRelations() returns accumulated RelationDefinition[] — update both DefinerWithoutArgs and Definer interfaces in src/schema/define.ts per contracts/orchestrator-api.md
- [x] T010 [US2] Add optional `relations?: RelationDefinition[]` field to SchemaDefinition interface and implement extractRelations() function in src/schema/define.ts. extractRelations() MUST validate: (a) relation names are unique within the schema, (b) source and target reference entity types defined in schema.entities. Throw descriptive error on violation. Returns [] when schema.relations is undefined or empty.
- [x] T011 [US2] Update src/schema/index.ts to re-export RelationDefinition, RelationInstance, extractRelations; update src/index.ts to re-export from schema
- [x] T012 [US2] Verify backward compatibility — run `npm test` and confirm all tests pass (RED tests from T007 now GREEN, existing tests unchanged)

**Checkpoint**: Schema supports relation declarations. Existing API unchanged. `npm test` green.

---

## Phase 3: Simulate Cascade — US1 (Priority: P1) MVP

**Goal**: Consumers can ask "if entity A transitions to state X, what cascades?" and get a complete trace

**Independent Test**: Create orchestrator with two entity types + relation, call simulate(), verify trace includes affected entities with correct cascade steps

**Depends on**: Phase 2 (Schema Relations)

### Tests (RED)

> **Write ALL simulation tests FIRST. They MUST fail before implementation begins.**

- [x] T013 [P] [US1] Write simulate() basic tests (single entity no cascade, two entities with relation triggering cascade, what-if forcing invalid status, entity_not_found error) in tests/orchestrator/simulate.test.ts — tests MUST fail (RED)
- [x] T014 [P] [US1] Write cascade behavior tests (3-hop chain A->B->C, diamond convergence, cycle termination within maxDepth, convergence flag true/false, conflict detection -> unresolved with conflicting targets, manual transition reporting, application order correctness) in tests/orchestrator/cascade.test.ts — tests MUST fail (RED)
- [x] T015 [P] [US1] Write edge case tests (empty entity map, entity with no relations, max depth reached -> truncated flag, preset throw -> cascade_error with partialTrace, missing entity in relation -> skip with warning) in tests/orchestrator/cascade.test.ts — tests MUST fail (RED)

### Implementation (GREEN)

- [x] T016 [US1] Implement createOrchestrator() factory in src/orchestrator/orchestrator.ts — accepts OrchestratorConfig, stores engine/machines/relations/strategy/maxDepth, returns Orchestrator with simulate() and execute() (execute() can be a stub initially)
- [x] T017 [US1] Implement BFS cascade core as internal function in src/orchestrator/orchestrator.ts — uses StateOverlay for virtual state, iterates BFS queue, calls engine.getValidTransitions() per entity, handles: (a) single auto-match -> apply to overlay + add to steps + enqueue downstream, (b) multi-match -> add to unresolved + explore downstream with pre-cascade state, (c) no match -> skip, (d) new manual transitions -> add to availableManualTransitions. Respects maxCascadeDepth, tracks convergence, builds CascadeTrace
- [x] T018 [US1] Implement simulate() method in src/orchestrator/orchestrator.ts — force trigger status into overlay (what-if), run cascade core, return SimulationResult (ok/entity_not_found/cascade_error with partialTrace)
- [x] T019 [US1] Finalize src/orchestrator/index.ts exports (createOrchestrator, propagateAll default strategy, all types) and update src/index.ts with orchestrator re-exports
- [x] T020 [US1] Update tests/entry-points.test.ts to verify orchestrator entry point exports (createOrchestrator, propagateAll, type re-exports) — all RED tests from T013-T015 MUST now be GREEN

**Checkpoint**: `simulate()` works for all cascade scenarios. MVP deliverable. `npm test` green.

---

## Phase 4: Execute with Cascade — US3 (Priority: P2)

**Goal**: Consumers can execute a validated transition and receive an ordered changeset of all cascaded state changes

**Independent Test**: Call execute() with valid/invalid transitions, verify changeset structure and trace inclusion

**Depends on**: Phase 3 (Simulate — reuses cascade core)

### Tests (RED)

- [x] T021 [US3] Write execute() tests (valid transition produces changeset, invalid transition returns validation_failed with reason, entity_not_found when trigger entity missing from map, changeset.changes matches trace.steps as StateChange[], changeset.trace is complete, changeset.unresolved shortcut works, execute result matches simulate prediction) in tests/orchestrator/execute.test.ts — tests MUST fail (RED)

### Implementation (GREEN)

- [x] T022 [US3] Implement execute() method in src/orchestrator/orchestrator.ts — validate trigger transition via engine.validate(), if invalid return validation_failed error, if valid run cascade core (without what-if forcing), wrap result in Changeset (changes: StateChange[], trace, unresolved) — all RED tests from T021 MUST now be GREEN

**Checkpoint**: `execute()` validates + cascades + returns changeset. `npm test` green.

---

## Phase 5: Custom Strategy + matchedIds — US4 + US5 (Priority: P2)

**Goal**: Consumers can filter cascade propagation by relation type; orchestrator uses matchedIds for instance-level targeting

**Independent Test**: Provide custom strategy that blocks certain relations -> verify only propagating relations appear in trace. Verify matchedIds-based targeting re-evaluates only referenced entities.

**Depends on**: Phase 3 (Simulate)

### Tests (RED)

- [x] T023 [P] [US4] Write strategy tests (custom filter blocks 'blocks' classification, default propagates all, strategy receives correct StateChange + RelationInstance, strategy metadata access works) in tests/orchestrator/strategy.test.ts — tests MUST fail (RED)
- [x] T024 [P] [US5] Write matchedIds dependency tests (preset returns specific matchedIds -> only those entities re-evaluated, matchedIds update on re-evaluation -> dependency map refreshes, empty matchedIds -> falls back to relation-based type-level propagation) in tests/orchestrator/cascade.test.ts — tests MUST fail (RED)

### Implementation (GREEN)

- [x] T025 [US4] Integrate propagation strategy into BFS cascade loop in src/orchestrator/orchestrator.ts — before enqueueing a neighbor for re-evaluation, call strategy(change, relationInstance) and skip if false. Default propagateAll strategy already in types.
- [x] T026 [US5] Implement matchedIds-based instance targeting in BFS cascade loop in src/orchestrator/orchestrator.ts — after engine.getValidTransitions() returns, collect matchedIds from evaluation results, use reverse mapping (matchedId -> which entities depend on it) to determine which specific entity instances to enqueue instead of all type-level neighbors. Precedence: if matchedIds are present, use them for instance-level targeting; if empty/absent, fall back to RelationInstance[]-based instance connections; RelationDefinition[] type-level propagation is the final fallback when no instance-level data exists. All RED tests from T023-T024 MUST now be GREEN.

**Checkpoint**: Propagation is filterable. Instance-level targeting works. `npm test` green.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, quality, and validation

- [ ] T027 Update CLAUDE.md architecture section — add orchestrator module description, update "Three modules" to "Four modules", add orchestrator entry point to imports list, update bundle size to <10KB
- [ ] T028 [P] Run full test suite with coverage (`npm run test:coverage`) and verify thresholds (90/90/80/90) pass
- [ ] T029 [P] Run typecheck (`npm run typecheck`), lint (`npm run lint`), format (`npm run format`)
- [ ] T030 Validate quickstart.md examples — create a scratch test file that implements the quickstart code snippets and verify they compile and produce expected results
- [ ] T031 [P] Extend generateDocs() in src/schema/docs.ts to include relation tables (relation name, source, target, direction, metadata summary) in generated documentation output. Add tests in tests/schema/docs.test.ts.
- [ ] T032 [P] Add cascade performance benchmark — create tests/orchestrator/benchmark.test.ts that verifies simulate() completes in <100ms for a 500-entity, 2000-relation graph (per NFR-001). Use vitest bench or a simple Date.now() assertion.
- [ ] T033 [P] Verify bundle size — run `npm run build` and assert total dist/ output is under 10KB (per NFR-002)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Schema Relations (Phase 2 / US2)**: Depends on Phase 1 — BLOCKS all subsequent phases
- **Simulate (Phase 3 / US1)**: Depends on Phase 2 — core cascade algorithm, MVP
- **Execute (Phase 4 / US3)**: Depends on Phase 3 — thin wrapper over cascade core
- **Strategy + matchedIds (Phase 5 / US4+US5)**: Depends on Phase 3 — extends cascade loop
- **Polish (Phase 6)**: Depends on all prior phases

### User Story Dependencies

```
Phase 1: Setup
    |
Phase 2: US2 (Schema Relations) <- FOUNDATIONAL, blocks everything
    |
Phase 3: US1 (Simulate) <- MVP
    |------------------------------\
Phase 4: US3 (Execute)    Phase 5: US4 (Strategy) + US5 (matchedIds)
    |                         |
Phase 6: Polish
```

- **US2 -> US1**: Relations must exist before simulate can use them
- **US1 -> US3**: Execute reuses simulate's cascade core
- **US1 -> US4**: Strategy filters within the cascade loop
- **US1 -> US5**: matchedIds targeting refines the cascade loop
- **US4 || US5**: Independent of each other, can be parallel
- **US3 || US4 || US5**: All independent after US1, can be parallel

### TDD Flow Within Each Phase

```
Write tests (RED) -> Verify tests FAIL -> Implement (GREEN) -> Verify tests PASS
```

### Parallel Opportunities

**Within Phase 1** (all [P]):

```
T002 (build config) || T003 (barrel file) || T004 (fixtures) || T005 (overlay tests)
```

**Within Phase 3 tests** (all [P]):

```
T013 (simulate tests) || T014 (cascade tests) || T015 (edge case tests)
```

**Phase 4 || Phase 5** (after Phase 3):

```
T021-T022 (execute) || T023-T026 (strategy + matchedIds)
```

**Within Phase 5 tests** (all [P]):

```
T023 (strategy tests) || T024 (matchedIds tests)
```

---

## Implementation Strategy

### MVP First (Phase 1 + 2 + 3 = US2 + US1)

1. Complete Phase 1: Setup (types, overlay TDD, build config)
2. Complete Phase 2: Schema Relations TDD (US2)
3. Complete Phase 3: Simulate Cascade TDD (US1)
4. **STOP and VALIDATE**: simulate() works for all cascade scenarios
5. This delivers the core value proposition — no existing library does this

### Incremental Delivery

1. Setup + Schema Relations -> Orchestrator compiles, relations declarable
2. Add Simulate -> Test cascade chains, cycles, conflicts -> **MVP!**
3. Add Execute -> Validated transitions with changesets
4. Add Strategy + matchedIds -> Domain-specific filtering, instance targeting
5. Polish -> Docs, coverage, validation

### Suggested MVP Scope

**US2 (Schema Relations) + US1 (Simulate)** = 20 tasks (T001-T020)

This delivers:

- Declarative relation schema
- Full cascade simulation with what-if
- Multi-hop, cycle-safe, conflict-aware cascade detection
- Immutability guarantees
- All edge cases handled

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks
- [Story] label maps task to specific user story for traceability
- TDD: Every phase writes tests FIRST (RED) then implements (GREEN)
- US4 and US5 modify the same function (BFS cascade loop in orchestrator.ts) but different sections — coordinate if implementing in parallel
- Zero new runtime dependencies — all implementation uses native TypeScript Map, Array, Set
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
