# GROW/WFO C4 authoring workflow implementation plan

- Status: validated
- Scope: validated authoring workflow primitives derived from the pinned GROW 2020 and WFO 2026-06 runs
- Excludes: consumer release construction, GitHub publication and automatic editorial acceptance

> Historical implementation baseline: the active work sequence is now the
> [four-source curation main track](four-source-curation-plan.md). This document describes the validated
> GROW/WFO workflow primitives retained as regression requirements; its future planned increments are retired.

## Objective

Create a file-based workflow that lets a curator inspect every generated GROW/WFO review item, record an
explicit decision, validate the resulting authoring dataset and measure its completion without a database
or runtime service. Generated review queues remain ignored aids. Reviewed authoring records remain
Git-tracked canonical data.

The workflow must work in two environments:

- a clean checkout validates tracked authoring records without downloading the WFO archive; and
- a local deep audit additionally compares those records with the ignored adapter and curation outputs.

Structural validity, editorial completion and release eligibility are separate results. A structurally
valid dataset may remain `in progress`; this workflow never labels it release-ready.

## Accepted workflow decisions

1. A WFO record remains an external, release-scoped reference. Curation creates Hortinis taxa,
   taxonomic names and crosswalks; it does not create or alter WFO records.
2. One current crosswalk represents one external source, release and identifier. Multiple GROW
   source-name decisions may reference the same crosswalk.
3. Each GROW record has its own current source-name decision and source-subject decision. A curator may
   select a different WFO identifier for any GROW record without duplicating unrelated decisions.
4. GROW records that share a WFO taxon may map to different Hortinis plant concepts, cultivar groups or
   cultivars. Repeated scientific names never imply a horticultural merge.
5. Assertion decisions are canonical per source candidate. Batch assistance may prepare several explicit
   decisions, but a selector must never cause future candidates to become accepted automatically.
6. GROW's combined `outdoor_sowing_or_planting` meaning is preserved. GROW evidence alone may support
   `establish_outdoors`, not a narrower `direct_sow` or `transplant` action.
7. Harvest-duration candidates remain deferred until their source anchor is resolved.

Decision outcome, review state and supersession are separate. A decision records the current substantive
outcome, its `reviewId` resolves the editorial state, and a newer record optionally names the older record
that it supersedes. `superseded` is therefore a derived historical state, not an outcome that leaves the
replacement unspecified. Rejected WFO proposals do not create external crosswalk records.

## Input and ownership boundaries

| Information                        | Authoritative input                                                      | Workflow behavior                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Source and licence metadata        | `data/sources/grow/` and `data/sources/wfo/`                             | Reference the tracked records and verify their declared identifiers and hashes.                       |
| GROW source records and candidates | `.cache/import-runs/grow/latest/`                                        | Use for local inspection and deep audit; never treat an unreviewed candidate as an authored record.   |
| WFO matches and taxonomic rows     | `.cache/import-runs/wfo/latest/`                                         | Propose release-scoped references; require an explicit crosswalk and name decision.                   |
| Additional manual WFO selections   | Pinned `.cache/source-inputs/wfo/2026-06/_DwC_backbone_R.zip`            | Look up by WFO identifier or name and emit an unreviewed proposal with its exact archive row locator. |
| Catalog subjects and their scope   | Curator decision                                                         | Mint or select stable opaque Hortinis identifiers; never derive identity from a path or array index.  |
| Review decisions                   | Curator decision                                                         | Record reviewer, time, purpose, status, confidence where allowed, and notes.                          |
| Evidence references                | Exact reviewed source record, release, locator, rights and normalization | Materialize deterministically only as part of an explicit accepted decision.                          |
| Authoring records                  | `data/curation/grow-wfo-initial/`                                        | Keep canonical JSON Lines sorted by stable identifier and review through ordinary Git changes.        |

The `data/validation/v1.2/` dataset is a `dev-validation` fixture and is not production authority. Its
identifiers or facts are not reused automatically.

## Canonical authoring dataset

Replace the filename-only authoring list with a schema-validated manifest containing collection
descriptors. A descriptor records the collection role, safe path, format and schema identifier. The
manifest also pins both source manifests, the relevant adapter configuration hashes and the curation
draft fingerprint used during review.

For this initial contract, `draftManifestSha256` is the SHA-256 of the canonical bytes of
`draft-manifest.json`. C4.2 adds hashes and record metadata for every queue so that local audit can verify
the draft contents as well as this top-level fingerprint.

The initial dataset supports these tracked collections:

| Collection                           | Purpose                                                                                   |
| ------------------------------------ | ----------------------------------------------------------------------------------------- |
| `taxa.jsonl`                         | Reviewed Hortinis taxonomic concepts.                                                     |
| `taxonomic-names.jsonl`              | Accepted and synonym names with WFO identifiers and evidence.                             |
| `plant-concepts.jsonl`               | Generic horticultural subjects, kept separate from taxa.                                  |
| `cultivar-groups.jsonl`              | Reviewed crop or cultivar-group scope where required.                                     |
| `cultivars.jsonl`                    | Reviewed cultivar subjects where required.                                                |
| `localized-names.jsonl`              | Reviewed language-tagged names; GROW common names remain candidates until reviewed.       |
| `geographic-contexts.jsonl`          | Reviewed country or other explicit source scopes.                                         |
| `cultivation-contexts.jsonl`         | Reviewed geography, growing-system and propagation combinations.                          |
| `evidence-references.jsonl`          | Exact source release, record, locator, original value, normalization and rights evidence. |
| `reviews.jsonl`                      | Content and rights decisions referenced by authored records.                              |
| `external-taxonomy-crosswalks.jsonl` | One current crosswalk per external source, release and identifier.                        |
| `source-name-decisions.jsonl`        | One current taxonomic interpretation per GROW source record.                              |
| `source-subject-mappings.jsonl`      | One current mapping or explicit supersession per mapped GROW source record.               |
| `source-geography-decisions.jsonl`   | Explicit normalization from preserved GROW geography to catalog geography.                |
| `source-assertion-decisions.jsonl`   | Accepted, rejected, deferred or superseded disposition of each reviewed candidate.        |
| `assertions.jsonl`                   | Accepted source-backed authoring assertions, not consumer records.                        |
| `curation-issues.jsonl`              | Open issues, resolved decisions and accepted limitations.                                 |

Tracked source and licence records may be declared as manifest dependencies instead of being copied into
the curation directory. Dependency descriptors must use repository-safe paths and include a checksum so
that the dataset cannot silently validate against changed metadata.

## Taxonomy and name model

An accepted WFO-name candidate proposes, but never accepts, the following records:

1. a Hortinis taxon, either newly minted or already present;
2. an accepted taxonomic-name record for the chosen WFO accepted name;
3. for a synonym outcome, a separate synonym name pointing to the accepted taxonomic-name record;
4. one crosswalk for each WFO external identifier that is actually retained; and
5. a GROW source-name decision referencing the crosswalk that explains the reviewed source name.

The draft generator must consolidate proposals by WFO source, release and identifier while retaining the
complete list of referring GROW records and WFO candidate identifiers. A source-name decision remains
record-specific, so two GROW records may share the consolidated crosswalk or deliberately reference
different reviewed crosswalks.

An unmatched or non-taxonomic crop-form label does not require a fabricated WFO record. Its source-name
decision may remain unresolved or be recorded as non-taxonomic. A non-taxonomic decision may map to a
reviewed Hortinis horticultural subject whose own taxon has independent evidence. An unresolved decision
does not permit assertion promotion.

Taxonomic validation must enforce:

- one current crosswalk per external source, release and identifier;
- one active accepted taxonomic name per active taxon for the selected WFO release;
- synonym and accepted-name records belonging to the same taxon;
- synonym links resolving to an active accepted name;
- WFO identifiers, names, ranks, statuses and locators matching the pinned local candidate during deep
  audit;
- an explicit supersession when a WFO release or reviewed interpretation changes; and
- consistency between a subject's taxon and the crosswalk used by its source-subject mapping.

## Assertion decision model

Add an authoring schema for one explicit decision per GROW candidate. It records:

- a stable decision identifier;
- the exact source candidate identifier and pinned draft fingerprint;
- `accept`, `reject` or `defer`;
- a reason and content-review identifier;
- the target authoring assertion identifier when accepted;
- the reviewed context and projection intent for a cultivation rule when relevant; and
- an optional superseded decision identifier when replacing an earlier choice.

An accepted decision materializes an assertion and its evidence but does not materialize a consumer fact
or cultivation rule. C5 owns authoring-to-consumer projection.

Calendar decisions remain record-specific:

- `outdoor_sowing_or_planting` may retain the combined intent and propose `establish_outdoors` with
  `direct_sowing_or_transplant` propagation;
- `harvest` may propose the `harvest` action;
- `indoors_or_undercover` remains deferred until its combined source meaning has an accepted authoring
  representation; and
- a narrower action supported by another source becomes a separate assertion with separate evidence. It
  does not rewrite the broader GROW claim.

For large reviewed groups, a batch input may contain an expected count and candidate-set SHA-256. Applying
it expands the frozen set into individual decision records. Any count or hash change makes the batch stale
and prevents writes.

## Validation levels

### Structural validation

Available in a clean checkout and suitable for basic CI:

- validate the dataset manifest and dependency descriptors;
- parse strict JSON and JSON Lines with line numbers;
- validate each record against its declared JSON Schema;
- enforce global identifier uniqueness and resolvable tracked references;
- validate reviews, rights, subject scope, supersession and value semantics; and
- produce deterministic diagnostics without requiring ignored source archives.

### Local source audit

Available when adapter and curation outputs exist:

- verify adapter run manifests, output hashes and curation draft hashes;
- reject a dataset reviewed against stale configuration or queue content;
- compare source identifiers, releases, record IDs, names, locators, raw values and WFO rows;
- verify that every accepted assertion came from the declared candidate; and
- verify that every generated review item is accounted for or reported as pending.

### Completion gates

Completion is reported separately from validity:

- **identity gate:** every GROW record has one current accepted decision, accepted unresolved limitation,
  or explicit rejection; all referenced WFO crosswalks and names resolve;
- **subject gate:** every assertion-eligible GROW record has one reviewed subject mapping and all repeated
  taxa or crop forms have an explicit scope decision;
- **context gate:** every accepted assertion has a reviewed geography and cultivation context;
- **assertion gate:** every candidate is accepted, rejected, deferred or superseded, and every accepted
  decision resolves to exactly one authored assertion; and
- **C4 gate:** all earlier gates pass and every remaining open issue is explicitly allowed by the C4
  completion policy.

The C4 gate does not imply `fr-mvp` profile approval or C5 release eligibility.

## Command surface

The validated non-interactive commands are:

```sh
pnpm curate:grow-wfo:drafts
pnpm curate:wfo:lookup --name "Scientific name"
pnpm curate:wfo:lookup --id wfo-identifier
pnpm curate:grow-wfo:show --source-record source-record-id
pnpm curate:grow-wfo:status
pnpm curate:grow-wfo:status --json
pnpm curate:grow-wfo:validate
pnpm curate:grow-wfo:validate --against-drafts
pnpm curate:grow-wfo:apply --input decision.json
```

`show`, `status`, `validate` and WFO lookup are read-only. `apply` is the only workflow command that writes
tracked authoring collections. It consumes an explicit curator-authored input, validates the entire
transaction, writes canonical records to a staging directory and replaces affected files only after every
gate succeeds. It refuses duplicate current decisions, implicit supersession and stale input. Re-running
adapters or draft generation never changes tracked authoring data.

## Ordered implementation increments

### C4.1 — Authoring workflow contracts (`validated`)

- Add the curation-dataset manifest schema and collection descriptors.
- Add source-geography-decision and source-assertion-decision schemas.
- Add taxonomic names to the in-memory dataset model and semantic validator.
- Clarify accepted, rejected, deferred and superseded decision semantics.
- Expand `data/curation/grow-wfo-initial/dataset-manifest.json` and add empty canonical collections.
- Add positive and negative schema-conformance fixtures.

Acceptance: every tracked authoring collection has one declared schema and ownership boundary; the
manifest validates; unresolved contract choices are recorded in `docs/open-questions.md`; no source
candidate is accepted or promoted.

### C4.2 — Draft integrity and pinned WFO lookup (`validated`)

- Validate source run manifests and their declared inputs before generating review queues.
- Correct exact-synonym proposal provenance.
- Consolidate crosswalk proposals by external source, release and identifier.
- Add schema IDs, record counts, byte sizes and SHA-256 hashes to draft output descriptors.
- Add read-only lookup by WFO name or identifier against the pinned archive.
- Keep the existing staging-directory and atomic-publication behavior.

Acceptance: identical inputs produce byte-identical queues and manifest; corrupted or mismatched inputs
fail without replacing the prior draft; shared and record-specific WFO choices have fixture coverage.

### C4.3 — Manifest-driven dataset loader and validator (`validated`)

- Load only collections declared by a validated manifest.
- Reject unsafe paths, duplicate roles, unknown schema identifiers and malformed JSON Lines.
- Validate every record through the compiled repository validation API.
- Run cross-record semantic checks with deterministic ordering and line-aware diagnostics.
- Support structural validation without `.cache` and optional deep audit with local drafts.

Acceptance: `pnpm curate:grow-wfo:validate` works from a clean checkout; `--against-drafts` detects source
or queue drift; ordinary data failures make no writes and return actionable deterministic diagnostics.

Implementation note: the validator is read-only. It loads only manifest-declared collections and tracked
dependencies, validates strict JSON/JSONL through the compiled schema registry, runs the existing
cross-record checks, and preserves collection paths and line numbers in deterministic diagnostics.
`--against-drafts` additionally checks the ignored draft manifest, queue descriptors, source-run fingerprints
and pinned WFO snapshot when those local inputs are available.

### C4.4 — Semantic integrity and completion status (`validated`)

- Enforce composite-key uniqueness for current crosswalks and decisions.
- Require accepted records to reference accepted reviews of the correct purpose.
- Enforce name-decision, crosswalk, subject-taxonomy and assertion prerequisites.
- Add taxonomic-name, geography, supersession and candidate-lineage checks.
- Report validity and each completion gate separately in human-readable and JSON forms.
- Add a joined read-only view for one GROW source record.

Acceptance: `status` accounts for all 140 GROW source records and all generated assertion candidates
without treating pending work as invalid data; invalid accepted relationships fail validation.

### C4.5 — Transactional decision application (`validated`)

- Define a small explicit decision-input format for taxonomy, subject, geography and assertion actions.
- Mint stable opaque catalog IDs without deriving them from file paths or array positions.
- Materialize final authoring records, evidence and reviews only from explicit inputs.
- Canonically sort affected collections and write them atomically.
- Require explicit supersession and refuse stale drafts or partial transactions.

The implementation uses the `decision-input` curation schema, pins the draft manifest, validates all
supplied records through the repository schemas, checks source-decision lineage against the exact draft
items, stages the full declared dataset, and publishes only after staged structural and deep validation
succeeds. Failure-injection, multi-action and repeat-application fixtures cover the transaction boundary.

Acceptance: applying the same decision twice is idempotent or fails clearly without duplicate records;
failed validation leaves tracked bytes unchanged; two applications to identical starting data produce
identical output bytes except for explicitly supplied review metadata.

The former C4.6–C4.8 editorial milestones are retired. Their future work is decomposed into T13–T19 of the
[four-source curation main track](four-source-curation-plan.md), which adds CropGraph candidates and TAXREF
localization while retaining the validated workflow primitives above.

## Test strategy

Fixture tests cover:

- shared WFO crosswalks referenced by multiple GROW records;
- different WFO selections for otherwise similar GROW records;
- accepted-name and exact-synonym modeling;
- ambiguous, unmatched, unresolved and non-taxonomic decisions;
- repeated taxa mapped to shared or distinct horticultural subjects;
- invalid review status, mismatched taxon, duplicate composite keys and invalid supersession;
- source geography normalization with original spelling retained;
- accepted, rejected and deferred assertion candidates;
- stale candidate-set and run fingerprints;
- transaction rollback and byte determinism; and
- clean-checkout structural validation without ignored archives.

The full local GROW/WFO run is a separate operator validation. It is not part of basic CI.

## Explicit exclusions

- No database, editorial HTTP service or mandatory UI.
- No automatic acceptance of exact WFO matches.
- No automatic horticultural merge based on a shared taxon or scientific name.
- No silent reuse of `dev-validation` records as production evidence.
- No narrowing of combined source actions without separate source-backed evidence.
- No source download or release publication in basic CI.
- No consumer JSONL.gz construction; that remains C5.
