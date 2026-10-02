# Integrated read-only curation

- Status: validated
- Scope: T17 inspection and audit of the generalized V1 dataset and T15/T16 frozen packets

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
remain T19 work in the open questions register.

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

The existing GROW/WFO commands and transactional application remain operational until T18. They reuse
the same V1 structural validator; there is no new schema version or migrated copy of authored records.
Changing the tracked dataset's editorial scope and admitting new source dependencies is explicit curator
work, not a side effect of generating or inspecting integrated packets.
