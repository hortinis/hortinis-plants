# Tests

Vitest tests are written in TypeScript and run in the Node.js environment.

- `unit/` contains focused unit tests named `*.test.ts`.
- `fixtures/` contains reusable fixture data grouped by contract or feature.
- Future conformance tests belong under `conformance/` and should reference
  fixtures rather than embedding large data objects in test files.

Run the test suite with `pnpm test` or collect V8 coverage with `pnpm coverage`.

Use `pnpm exec vitest run --coverage --maxWorkers=2` for bounded local test concurrency.
`curation-coverage.test.ts` exercises denominator, readiness, rights and cultivar-scope accounting;
`curation-apply.test.ts` verifies apply/regenerate/deep-audit coverage with unchanged and changed history.
`pnpm verify:curation` performs the full pinned offline integration rehearsal and writes ignored
hash/memory evidence under `.cache/verification/t19/`. It requires local WFO and TAXREF archives.
See the [runbook](../docs/development/curation-runbook.md) for preparation and recovery.
