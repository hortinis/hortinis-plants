# Tests

Vitest tests are written in TypeScript and run in the Node.js environment.

- `unit/` contains focused unit tests named `*.test.ts`.
- `fixtures/` contains reusable fixture data grouped by contract or feature.
- Future conformance tests belong under `conformance/` and should reference
  fixtures rather than embedding large data objects in test files.

Run the test suite with `pnpm test` or collect V8 coverage with `pnpm coverage`.
