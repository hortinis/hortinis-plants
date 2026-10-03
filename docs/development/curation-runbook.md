# Four-source acquisition, verification and C5 handoff

- Status: validated
- Scope: T19; offline source preparation, integrated review, coverage and recovery

## Acquire and verify pinned inputs

Use Node.js 24 and the pnpm version in `package.json`. Install dependencies with
`pnpm install --frozen-lockfile`. The source manifests and adapter guide specify the
exact releases, resources, checksums and rights limitations. Acquisition is a manual
preparation step; import and review commands never download missing material.

GROW and the selected CropGraph resources are tracked under their source release
directories. Place the pinned WFO archive under `.cache/source-inputs/wfo/2026-06/`
with the filename declared by the WFO manifest. Place the TAXREF archive under
`.cache/source-inputs/taxref/18.0/TAXREF_v18_2025.zip`. Keep these archives out of Git.
Run `pnpm verify:taxref-pin` before TAXREF parsing. Importers verify their other
declared resources before publishing output. Never refresh a checksum to make an
unexpected download pass: investigate the source release first.

Commercial rights must be reviewed for the actual claim and upstream evidence.
A declared file licence, bibliography entry or successful checksum is not an
assertion-level redistribution clearance.

## Import and freeze review material

```sh
pnpm import:grow
pnpm import:cropgraph
pnpm import:wfo
pnpm import:taxref
pnpm reconcile:taxref-wfo
pnpm curate:drafts -- --dataset data/curation/grow-wfo-initial
```

WFO reconciliation consumes GROW and the authored CropGraph cohort. TAXREF
reconciliation consumes reviewed WFO crosswalks; an empty outcome set before
identity review is expected. Generating packets does not admit four-source
dependencies to the tracked dataset or accept candidates. The first integrated
transaction must make that manifest transition explicitly.

Inspect `pnpm curate:status -- --json` and `pnpm curate:show -- --packet <id> --json`.
Use the [integrated workflow](integrated-curation.md) to prepare an explicit
transaction, then run `pnpm curate:apply -- --input <decision.json> --json`.
Refresh reconciliation when reviewed WFO identity changes and regenerate drafts
after application. The consumed draft remains stale; never rewrite its pins.

## Delivery coverage and C4 completion policy

`data/curation/delivery-targets.json` enumerates the 33 ADR-0005 concepts and two
tomato cultivar exemplars. Each target has an opaque identifier independent of its
label and position. Initially the targets are unbound. A curator supplies the
exact `subjectId` and an accepted content `reviewId` together; the report does not
match labels to source names. Target bindings are a separate tracked editorial
input, selected with `curate:status -- --targets <path>` and fingerprinted in JSON
output. Changing them does not change frozen packet scope or accept source data.

`curate:status` adds `coverage` to its JSON result. It separately reports GROW
records, selected CropGraph records, candidate-family dispositions, actions,
accepted assertions, commercial rights, contexts, unique comparisons, delivery
targets and accepted limitations. Subject preferred names and taxon preferred names are reported separately; TAXREF
localization does not automatically attach a name to a crop form. Existing localization accounting retains its
unique reviewed-WFO-crosswalk denominator; linked proposals are not accepted names.
Missing drafts have null source denominators, rather than completed zero-row gates.

The explicit `c4-readiness-v1` policy requires:

- Successful structural validation, frozen draft integrity and a requested deep audit.
- All 140 pinned GROW and 5,006 selected CropGraph records in scope, each with an
  identity disposition and subject disposition. Unresolved identity needs an
  explicitly reviewed accepted limitation referencing its decision ID.
- A reviewed disposition for every identity candidate, taxonomy outcome,
  cultivation candidate, localization proposal and unique comparison. Identity
  operations without a candidate selector cover their frozen identity/taxonomy
  snapshots; cultivation and localization still require their own decisions.
- Accepted assertion evidence with accepted rights reviews and commercial use
  allowed for every licence. Unknown geography or growing system requires an
  accepted limitation referencing the assertion ID.
- Explicit reviewed WFO identity and subject bindings for all delivery targets.
  Each generic MVP target has cold-sensitivity and planting-window coverage, or
  an accepted limitation referencing the target ID. These are source-backed
  authoring counts; C5 still assesses their applicability to France and projection.
- No open issue. Every `accepted-limitation` issue has a resolution and a current
  accepted issue-operation snapshot. Each deferred domain or packet decision must
  be referenced by such an issue; a reason on a deferral alone does not waive it.

French and English preferred names are reported independently. Their absence does
not block C4 readiness, following ADR-0005's explicitly tagged fallback policy.
Cultivar evidence never counts as generic-concept evidence. Narrower inheritance
and consumer fallback are C5 responsibilities.

The original T17 editorial gates retain exact selected-draft counting. T19 coverage
can additionally account for historical packet decisions after a successful deep
audit when the exact source record, rights evidence, non-authoring packet input
dependencies, selected candidates and comparisons still match, and the regenerated
packet contains the immutable decision snapshot. The sole excluded dependency is
the authoring dataset manifest, which changes during the explicit T18 transition.
The approval keeps its original hash. Changed evidence requires new review;
read-only status without deep audit cannot reuse historical approvals.

## Verify locally and in a clean checkout

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm exec vitest run --maxWorkers=2
pnpm exec vitest run --coverage --maxWorkers=2
pnpm verify:curation
```

Fixture tests exercise corrupt and stale pins, malformed input, replay rejection,
mixed-batch rollback, publication-failure recovery, explicit localization,
supersession and unchanged-history accounting. Structural validation and coverage
unavailability are tested without source archives or drafts.

`verify:curation` is a full local rehearsal requiring both large pinned archives.
It writes exclusively under ignored `.cache/verification/t19/`. It runs GROW,
CropGraph, WFO, TAXREF, TAXREF/WFO reconciliation and packet generation twice,
hashes every generated file, and requires identical file inventories and bytes.
Each stage also receives a missing-input failure and must preserve its previous
successful output. Malformed and mid-publication failures are covered by fixtures.
It then runs structural validation and deep audit, and saves coverage and a
verification report. A previous report is replaced only after all checks pass.
Each completed stage also saves its own receipt, so a later audit/report failure
does not lose the earlier hash and memory evidence. To compare a fresh rerun with
the retained successful staging outputs, run
`pnpm verify:curation -- --verify-existing`. That mode records the first output as
an existing baseline without a memory measurement, measures the fresh rerun, and
performs the same failure-preservation and audit checks. Missing baseline output
fails rather than silently switching to another mode. `--clean-only` runs just
the isolated checkout rehearsal and writes a separate report.

Each stage runs in a separate Node process with a 1,024 MiB heap limit and a
1,536 MiB observed peak RSS ceiling on Linux. Memory is measured using Node's
`process.resourceUsage().maxRSS`; missing measurements fail verification. This is
a bound for the pinned workload, not a claim of constant memory for arbitrarily
larger cohorts. Archive parsing and file hashing remain streamed. A memory failure
requires investigation, not a silently increased budget.

In a checkout without `.cache`, run `pnpm build` and `pnpm curate:validate`.
Structural validation must pass without archives. `curate:status -- --json` must
report unavailable source coverage, and an explicitly requested deep audit must
fail with actionable missing-input diagnostics. Restore verified local inputs
before the full rehearsal. Fixture tests provide this isolation even on a machine
that already has local archives.

## Recover failed or interrupted work

Importer and draft failures leave the prior successful output in place. Correct
the input and rerun the same command; never edit generated manifests manually.
Apply validation and caught publication failures preserve or restore the original
dataset. Preserve diagnostics and compare dataset fingerprints before retrying.

For process termination between dataset directory moves, stop all writers. Locate
the matching sibling `.curation-backup-*/dataset` and `.curation-apply-*` directories.
If the dataset is absent, restore the backup to its original path. If present,
validate it structurally and compare fingerprints before choosing which version
to retain. Keep the backup until recovery is verified. Remove a stale
`<dataset>.apply-lock` and abandoned stage only after confirming no writer is active.
No power-loss durability or filesystem-wide atomic exchange is claimed.

## C5 handoff boundary

Hand off the exact authoring dataset fingerprint, target fingerprint, successful
deep-audit evidence, coverage report, reviewed limitation records and source pins.
C5 reads current explicitly reviewed authoring records with resolvable evidence
and rights reviews. Frozen source records, candidates, proposals, packet decisions
and rejected/deferred snapshots are audit material; they are not accepted catalog
facts. Preserve them for explanation without projecting them as assertions.

C5 applies profile-specific rights, supersession, geographic applicability,
inheritance and projection rules. It builds deterministic JSONL.gz chunks, release
manifests and attribution, and owns publication. C4 readiness is not `fr-mvp`
approval. A successful rehearsal can accompany `in progress` editorial readiness;
it must never change actual source admission or authoring reviews.
