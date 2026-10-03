# T19 verification evidence

- Status: validated
- Verification date: 2026-10-02
- Runtime: Node.js 24.18.0

The full fixture suite passes: 29 files and 204 tests with
`pnpm exec vitest run --maxWorkers=2`. Formatting, lint, typecheck and build pass.
The delivery-target contract has positive and negative schema-conformance fixtures.

Focused V8 verification of coverage, integrated inspection and transactional
application passes 67 tests. The new `curation-coverage.ts` module has 95.97% line
coverage and 84.23% branch coverage in this run. The full instrumented suite hit
existing archive-test timeouts; this evidence does not claim a passing full-suite
V8 run. Generated coverage output remains ignored under `coverage/`.

The isolated checkout rehearsal passes structural validation without source
archives or drafts, reports unavailable coverage, and rejects a requested deep
audit. Its generated receipt is `.cache/verification/t19/clean-checkout-report.json`.

The pinned local pipeline verifies GROW, CropGraph, WFO, TAXREF, TAXREF/WFO and
integrated packets. Each completed stage writes an ignored receipt containing
its full output hash inventory, failed-input preservation result and measured
peak RSS. The initial two-fresh-run rehearsal completed those stages, then exposed
scalar and array cultivation values in final action reporting. The corrected
reporter has regression coverage. The finishing rehearsal compares a measured
fresh rerun against the retained successful baseline and records the baseline's
memory measurement as unavailable rather than inventing a value.

The finishing local rehearsal passes all six stages, failed-input preservation,
isolated clean-checkout checks and the final deep audit. Its successful report is
`.cache/verification/t19/verification-report.json`, in `existing-baseline-and-rerun`
mode. Real source and delivery accounting is saved in
`.cache/verification/t19/coverage.json`: 140 GROW records, 5,006 CropGraph records,
33 MVP concept targets and two cultivar exemplars. Structural validation, source
audit and draft integrity all have status `validated`.

Measured stage peaks range from about 155 MiB to 582 MiB RSS, below the 1,536 MiB
ceiling. The report records exact KiB values and output file hashes. The existing
baseline's absent memory measurement is explicitly null. Reports and staging
outputs remain ignored; this document records the verification outcome rather
than committing generated artifacts.

Tooling verification does not admit four-source editorial dependencies, bind
delivery targets or accept source candidates. C4 editorial readiness remains
`in progress`; C5 release construction and profile eligibility remain separate.
The [runbook](../development/curation-runbook.md) defines preparation, recovery,
completion policy and the handoff boundary.
