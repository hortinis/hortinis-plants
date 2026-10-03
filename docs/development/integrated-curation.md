# Integrated curation

- Status: validated
- Scope: T17 inspection and audit, T18 transactional application, T19 coverage, and T15/T16 frozen packets

The authoring dataset is selected explicitly with `--dataset`; the default remains
`data/curation/grow-wfo-initial`. Its name does not determine its collection layout. Collections,
schemas and tracked source dependencies come from `dataset-manifest.json`.

## Commands

```sh
pnpm curate:validate -- --dataset data/curation/grow-wfo-initial
pnpm curate:status -- --dataset data/curation/grow-wfo-initial --json
pnpm curate:show -- --source-record 1 \
  --source-id source_grow_edible_plant_database \
  --source-manifest-id source_manifest_grow_epd_2020 \
  --source-release doi:10.15132/10000157
pnpm curate:show -- --packet <packet-id> --json
pnpm curate:lookup -- --name "Solanum lycopersicum"
```

Every command supports `--json` and `--help`. JSON output is one result object; human-readable output
uses the same result. Validation and inspection exit with code 1 for invalid requested checks, malformed
arguments or unavailable required material. Pending editorial work alone does not cause a nonzero exit.

`show` joins by a complete qualified source-record key or opaque packet identifier. Partial selectors
are accepted only when exactly one packet matches. Equal local IDs from different sources or releases
are never joined. The view includes original source evidence, every candidate, WFO outcomes, TAXREF
proposals, comparisons, rights evidence, current authored records and decision history.

`lookup` remains a conservative WFO botanical lookup. Use `--id` instead of `--name` to query a WFO
identifier, and `--snapshot <archive>` for a relocated local archive. The WFO source manifest is selected
from the dataset's dependencies, or explicitly with `--source-manifest <path>`. Its release pin is verified
before parsing. An explicit `--drafts` or `--scope` additionally checks frozen review material. Lookup
results remain unreviewed proposals; TAXREF never supplies a second identity backbone.

## Generate frozen review material

After the source imports and TAXREF/WFO reconciliation:

```sh
pnpm curate:drafts -- --dataset data/curation/grow-wfo-initial \
  --cohort data/sources/cropgraph/cohort.json \
  --output .cache/curation-drafts/integrated/latest
```

Run-directory overrides use repeatable `--run <role>=<directory>` options. The supported roles are
`grow-importer-run-manifest`, `cropgraph-importer-run-manifest`, `wfo-reconciliation-run-manifest`
and `taxref-wfo-reconciliation-run-manifest`. Source metadata can be selected with repeatable
`--source-manifest <grow|cropgraph|wfo|taxref>=<path>` options.

`--cohort` selects the already authored CropGraph inclusion file consumed by the import. It cannot
reselect records from a different run. `--scope <path>` selects an existing frozen `review-scope.json`:
generation must reproduce its content exactly, or fail before replacing the previous draft. Inspection
requires its bytes to match the scope descriptor. The cohort and frozen review scope are different inputs.

Generation writes only generated review artifacts, normally in ignored cache paths. It does not edit
the dataset manifest, accept candidates or carry approvals across changed inputs.

## Independent validation dimensions

Structural validation reads tracked collections and tracked source metadata only. It validates schemas,
references, source qualification, reviews and supersession without requiring ignored archives or drafts.

`status` and `show` additionally verify frozen scope, queue, packet and comparison artifacts. Hashes,
sizes, counts, packet content digests, source keys, membership and candidate snapshots must agree. This
draft-integrity result is separate from structural validity and the source audit.

```sh
pnpm curate:validate -- --deep \
  --dataset data/curation/grow-wfo-initial \
  --drafts .cache/curation-drafts/integrated/latest \
  --scope .cache/curation-drafts/integrated/latest/review-scope.json
```

Deep validation verifies all declared runs, their configurations, local resources, staged outputs,
source manifests, authoring snapshots, the cohort and packet dependencies. It also audits current
decision lineage against frozen candidates and comparisons. Large resource hashes and JSONL validation
are streamed. No network acquisition is performed.

Use repeatable `--input <locator-or-role>=<path>` to relocate inputs such as `wfo-source-snapshot` or
`taxref-archive`. Use `--source-directory <grow|cropgraph|taxref>=<directory>` for importer resource roots,
and `--run <role>=<directory>` for relocated runs. Relative paths inside manifests must remain within
their declared root, including after resolving symlinks.

An unrequested source audit has status `planned` and `valid: null`. Stale cached inputs block the
source audit while leaving the independent structural result intact. Missing default drafts leave
coverage unavailable (`available: false`, null denominators); they do not create a completed zero-row gate.

## Accounting and localization

Editorial gates account for current decisions whose content review is accepted. Superseded decisions
remain inspectable but are not counted. Assertions and comparisons also require the selected draft
fingerprint. Rejection and deferral are reported separately. A `validated` accounting gate means every
item has a reviewed disposition; it does not mean every item became an accepted catalog fact. Unresolved
identity decisions remain pending. Aggregate C4/publication readiness and accepted-limitation policy
are defined by `c4-readiness-v1` in the [T19 runbook](curation-runbook.md).

Localization is reported independently. Its denominator is the unique current reviewed WFO crosswalks
used by reviewed source-name decisions in scope. Source records without that reviewed identity are
`notYetEligibleRecords`; eligible crosswalks without an outcome are `notReconciled`. Actual TAXREF outcomes
are counted as `linked`, `ambiguous`, `not-found` or `concept-disagreement`. Shared outcomes and comparisons
are counted once. Proposals and authored French names are separate counts; neither implies editorial
acceptance or crop-form equivalence. Missing localization never changes a WFO identity gate.

## Review baselines and transition

Integrated drafts hash the dataset manifest and collections they were generated from. Their own hash
must therefore not be written back into that manifest as a baseline. Existing configuration, source/run
and scope baselines remain independent pins; assertion and comparison decisions retain their exact draft
hash. The historical `draft-manifest` baseline applies only to the historical GROW/WFO workflow.

The historical GROW/WFO commands remain regression adapters. Application shares the directory transaction
engine and writer lock with `curate:apply`; integrated decisions use the generalized V1 validator. There
is no new schema version or migrated copy of authored records.
Changing the tracked dataset's editorial scope and admitting new source dependencies is explicit curator
work, not a side effect of generating or inspecting integrated packets.

## Apply an explicit integrated transaction

```sh
pnpm curate:status -- --dataset data/curation/grow-wfo-initial --json
pnpm curate:show -- --packet <packet-id> --json
pnpm curate:apply -- --input decision.json \
  --dataset data/curation/grow-wfo-initial \
  --drafts .cache/curation-drafts/integrated/latest \
  --scope .cache/curation-drafts/integrated/latest/review-scope.json --json
```

`apply` always performs a local deep audit. The decision file must conform to
`urn:hortinis:plants:schema:curation:v1:integrated-decision-input`. Use `baseDatasetSha256` and
`draftManifestSha256` from `status --json`. The base fingerprint includes the exact dataset manifest
and every declared collection. Source/run overrides use the existing `--run`, `--source-directory`
and `--cohort` options. For relocated source resources, use repeatable `--resource <locator-or-role>=<path>`;
`--input` names the transaction file only. No network acquisition occurs.

Each operation declares `kind`, `mintAlias`, `reviewId`, `disposition` (`accept`, `reject` or `defer`),
`reason`, `source` and `records`. The source contains `packetId`, its exact `packetSha256`
(from `packet.contentSha256`), and the complete `sourceRecordKey`. Assertion and context operations
also enumerate cultivation `candidateIds`; localization operations enumerate proposal IDs in that
field. Comparison operations enumerate `comparisonIds`. Identity and subject operations may enumerate
identity or taxonomy candidate IDs. A context decision with an unknown source context must preserve
that uncertainty; it does not calculate French dates or transfer US zones.

Records declare the collection and a complete authored value. A missing value ID can be minted with
an explicit record `mintAlias`. IDs retain the existing `hortinis:c4:<transactionId>:<collection>:<alias>`
SHA-256 namespace; paths and member positions never determine them. Cross-record references use explicit
IDs, which can be computed with the exported `mintStableId` helper. Operation aliases are unique within
the transaction. `batches` contain named, explicitly enumerated `members`, each a complete operation;
they expand to ordinary individual decisions before validation. Batch names are labels, not selectors.
Use one member per reviewed candidate when making batch dispositions.

Content reviews must be accepted, even when their reviewed disposition rejects or defers a proposal.
Domain decisions remain explicit: identity needs a source-name decision, subject needs a source-subject
mapping, assertion needs an individual source-assertion decision for every selected candidate, comparison
needs an individual comparison decision, and issue needs a related issue record. Localization acceptance
requires the exact TAXREF proposal string, language, reviewed WFO taxon and candidate evidence. The engine
never maps a localized name to a crop form automatically. Rejection and deferral create no accepted names.
Dynamic `plant_now` assertions remain rejected or deferred. Accepted assertions retain the candidate raw
value in evidence normalization, alongside source locators and explicit rights reviews.

## Explicit manifest transition

The first integrated transaction supplies a complete prospective `datasetManifest`. It preserves the
existing dataset ID, collection declarations and pinned dependencies, while explicitly:

- Selecting its editorial `scope` and setting `reviewDraftCommand` to `pnpm curate:drafts`.
- Admitting all four pinned source manifests and the required source/licence metadata.
- Declaring `packet-decisions.jsonl` with role `packet-decisions`, format `jsonl`, schema
  `urn:hortinis:plants:schema:authoring:v1:packet-decision` and authority `curator-authored`.
- Removing the historical `draft-manifest` baseline. Keeping independent configuration, source/run and
  cohort pins only when they match the frozen inputs.

The integrated draft, integrated review scope and authoring snapshots contain authoring hashes. Their
hashes cannot become manifest baselines. Transaction and packet-decision records carry those pins instead.
An existing source dependency cannot be repinned by an apply transaction; source-release migration is a
separate editorial change. Later transactions may omit `datasetManifest` when its declarations are sufficient.
The checked-in dataset remains in its existing scope until a curator supplies this explicit transition.

## History, supersession and validation

Every operation materializes one immutable packet decision containing its original draft pin, source
record, selected candidate/comparison snapshots, dependencies, rights evidence, review, disposition and
authored record snapshots. These tracked records preserve rejected and deferred claims when generated
review material is replaced. `show` exposes them under `decisions.packet`. Unrelated authored records,
conflicting writes and unsupported collections reject the whole transaction.

Domain decisions retain their existing supersession fields. An operation replacing a current packet
disposition uses `supersedesDecisionId`; it must replace the same packet/kind/selection (or issue target).
Existing records cannot be overwritten with different content, except for explicitly reviewed issue state
and localized-name preference changes. Those require `previousValueSha256`, the canonical content digest
of the existing value. Localized-name replacement changes only `preferred`; changed names require new IDs.
The packet decision records the previous value, preserving the history of these replacements.

The original authoring snapshot and all source inputs are validated before staging. The complete prospective
dataset receives structural, baseline, reference, review, supersession and frozen-candidate lineage checks,
without comparing the new authoring bytes to the original authoring hashes. Immediately before publication,
the engine verifies the original dataset and frozen inputs again. Untouched collection bytes are preserved;
changed collections are canonical JSONL sorted by opaque ID. Repeating a transaction or reusing its ID is
clearly rejected. No approvals or manifest hashes are silently refreshed.

After application, the consumed draft still describes the previous authoring snapshot. Structural validation
continues to pass; deep validation against that consumed draft reports stale inputs. Refresh affected
reconciliation jobs and generate a new draft for further work. Historical decisions keep their original
hashes and immutable snapshots. A regenerated packet may carry that exact history, allowing deep audit to
recognize it without treating it as a new approval. Assertion/comparison completion accounting still requires
the selected draft hash; new review decisions must explicitly supersede history when reviewing a new draft.
T19 coverage can account for unchanged historical evidence after a successful deep audit without
repinning approval hashes. The T17 gates above retain their original exact-draft semantics. See the
[completion policy and handoff runbook](curation-runbook.md).

## Failure and recovery

Both apply entry points acquire a sibling `<dataset>.apply-lock` directory before application. A competing
writer fails without removing that lock. Staging uses a sibling `.curation-apply-*` directory. Validation,
materialization and stale-input failures leave every tracked dataset byte unchanged.

Publication moves the original dataset to `.curation-backup-*/dataset`, then moves the validated stage into
place. A caught failure between these moves restores the original directory. Output fingerprints are computed
before publication. A cleanup failure after publication is reported as `retainedBackup` in a successful
result; it does not turn a committed transaction into a reported failure.

A process termination or machine failure between the two directory moves requires manual recovery. Stop all
writers first. If the dataset is absent, restore the saved `dataset` directory from the matching backup root
to its original path. If the dataset exists, validate it structurally and compare its fingerprint before
choosing whether to keep it or restore the backup. Preserve the backup until the choice is verified. Remove
a stale apply lock and abandoned stage only after confirming no writer is active. Publication does not claim
power-loss durability or a filesystem-wide atomic exchange.
