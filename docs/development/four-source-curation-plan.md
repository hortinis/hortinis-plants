# Four-source curation main track

- Status: planned
- Planning date: 2026-09-17
- Scope: reproducible staging, WFO-first identity review, French localization and source-backed cultivation curation
- Main track: this document replaces the former broad four-source implementation sequence
- Excludes: automatic acceptance, production publication, climate-grid construction and live recommendations

## Decisions

This work remains in development. Existing V1 schemas and data are updated in place; no parallel V2 contract
or legacy-compatibility branch is required.

WFO is the botanical identity backbone and the default source for the catalog display name. TAXREF is primarily
a French localization and territory/status enrichment source. TAXREF may expose a mapping disagreement, but it
does not create a second identity-completion gate and does not rewrite a WFO-backed taxon.

GROW and CropGraph are cultivation and horticultural evidence sources. Their source records, crop forms,
cultivars, actions, timing, geography and rights remain separate until an explicit review decision joins them.

All generated candidates remain unreviewed. Adapter reruns never accept data, remove authored decisions or
silently carry approvals across changed inputs.

## Source roles and data flow

| Source    | Role                                                                 | First-track output                          |
| --------- | -------------------------------------------------------------------- | ------------------------------------------- |
| GROW      | Existing cultivation, common-name and source-location evidence       | Existing source records and candidates      |
| CropGraph | Crop forms, names, action-bearing windows and cultivation candidates | Raw records, selected cohort and candidates |
| WFO       | Botanical identity, accepted names and synonyms                      | Identity proposals and taxonomic closure    |
| TAXREF    | French vernacular names and territory/status enrichment              | Localization proposals linked to WFO review |

```text
GROW ───────┐
            ├─> qualified source-name seeds ─> WFO identity proposals ─> review packets
CropGraph ──┘                                      │                         │
                                                   └─> TAXREF localization    │
                                                                                └─> explicit decisions
GROW/CropGraph cultivation candidates ───────────────> comparison and review ──> authoring dataset
```

Large archives and generated outputs remain in ignored `.cache` paths. Tracked files are source metadata,
small fixtures, scope configuration and curator-owned authoring data. The implementation uses Node.js 24,
TypeScript, pnpm, JSON Schema 2020-12, Ajv and Vitest. No database, mandatory external API or runtime HTTP
service is introduced.

## Ordered implementation tasks

Each task has one bounded responsibility and its own acceptance test. Tasks may be implemented in parallel only
when their listed dependencies are complete.

### T1 — Record source-authority decisions (`validated`)

Update the open-questions register and this plan with the WFO-first/TAXREF-localization policy. Define the
TAXREF outcomes `linked`, `ambiguous`, `not-found` and `concept-disagreement`. A TAXREF disagreement is an
issue or localization limitation, not a replacement identity.

Dependencies: none.

Acceptance: the source register, field matrix and open questions agree; no dependent task needs to infer which
taxonomy is authoritative.

### T2 — Add qualified source-record keys (`validated`)

Define one reusable V1 qualified key containing a nested `source` release key (`sourceId`,
`sourceManifestId`, `sourceReleaseId`) and `recordId`. Add a separate release-qualified source-location key
with `locationId`, plus a semantic-subrecord key for source fields, CropGraph windows and nested claims. Add
canonical TypeScript key helpers and replace bare `sourceRecordId` map keys in curation validation, status,
show, draft generation and lineage checks.

Array positions may appear in evidence locators but never in stable IDs. Equal local IDs from different sources
must coexist; duplicate complete keys must fail.

Dependencies: T1.

Acceptance: fixtures cover two sources with local record ID `1`, duplicate complete keys, reordered arrays and
qualified source-location keys.

### T3 — Generalize the V1 dataset manifest (`validated`)

Update the current authoring manifest in place. Remove the exact-17-collection constraint, replace named
GROW/WFO baseline fields with generic typed baseline descriptors, allow new collection roles and enforce unique
roles, paths and dependency IDs.

Dependencies: T2.

Acceptance: a four-source manifest validates; duplicate roles and paths fail; the current tracked collections
remain representable without renaming their files.

### T4 — Generalize run, scope and draft descriptors (`validated`)

Replace named GROW/WFO run fields and fixed reconciliation counts with generic arrays of hashed input, scope,
queue, packet and output descriptors. Every descriptor records role, schema, path or locator, byte size, count
and SHA-256 where applicable.

The existing one-source importer runner remains the common execution boundary; this task changes the contracts
that consume its outputs.

Dependencies: T2–T3.

Acceptance: one manifest describes GROW, CropGraph, WFO and TAXREF inputs; output and input roles are unique;
changed bytes change the fingerprint.

### T5 — Extend authored actions and timing in V1 (`validated`)

Extend the authoring assertion and decision schemas to represent CropGraph actions and typed timing. Use the
existing catalog action vocabulary (`start_indoors`, `direct_sow`, `transplant`, `plant`, `harvest`,
`establish_outdoors`) and support calendar, relative-day and applicable threshold forms.

Preserve raw action, mapping method and source timing. Keep `plant_now`, ambiguous soil-temperature meaning and
unanchored harvest duration deferrable; do not narrow them automatically.

Dependencies: T1.

Acceptance: positive and negative fixtures cover every supported action, negative frost offsets, ambiguous
actions and invalid narrowing.

### T6 — Add assertion comparison contracts (`validated`)

Add generated comparison records for `agreement`, `conflict` and `not-comparable`, plus reviewed decisions for
an explicit preferred assertion, retain-both or defer. Every comparison references qualified candidates and
preserves both source claims. No averaging or implicit source priority is permitted.

Dependencies: T2 and T5.

Acceptance: absolute dates and frost-relative windows can be non-comparable; a preference references a specific
assertion; source ordering cannot affect the result.

### T7 — Migrate the current V1 authoring dataset (`validated`)

Apply the generalized V1 manifest and collection layout in place. Add new empty collections where required and
preserve existing IDs, reviews, supersession links and file paths. Do not add a permanent V2 reader or legacy
transaction branch.

Use a populated synthetic fixture to prove migration behavior even though the tracked collections are currently
empty. Migration must be deterministic and must refuse unknown or incomplete source references.

Dependencies: T3–T6.

Acceptance: the tracked dataset validates after migration; the populated fixture preserves every authored ID
and link; no collection is reset or silently omitted.

### T8 — Pin and document CropGraph (`validated`)

Create CropGraph source, licence, manifest and README metadata. Pin commit `e722c3415bcf2773277f3422e13a4de5efd29b48`,
record exact resources, checksums, citations, bibliography inheritance and exclusions, and keep code and data
licensing distinct.

Dependencies: T4.

Acceptance: exact local bytes are verifiable offline; wrong files fail before parsing; excluded datasets and
rights limitations are explicit.

### T9 — Pin and document TAXREF (`validated`)

Pin TAXREF v18.0 and its bundled methodology PDF. Record the archive and per-member checksums, actual member
names, encoding, delimiters, vernacular-name fields, territory/status code lists, external links, change history
and removed identifiers. Verify the complete archive before any parser starts and fail with a path-specific
diagnostic when a required member is absent or changed. Keep the large archive outside Git.

Dependencies: T4.

Acceptance: `pnpm verify:taxref-pin` verifies the archive and all nine members; missing documentation or code
lists fails with an actionable diagnostic. Commercial reuse follows TAXREF's published Open Licence terms with
attribution; no numbered licence version is asserted.

### T10 — Implement CropGraph raw staging and scope (`validated`)

Stream the calendar, validate entries, emit raw source records and diagnostics, detect duplicate slugs and
inventory excluded files. Then freeze the selected CropGraph cohort with an explicit inclusion/exclusion file,
rationale and fingerprint. The importer consumes this selection; it does not recreate it heuristically.

Dependencies: T8.

Acceptance: malformed entries fail deterministically; the full source is accounted for; selected records are
stable under input reordering; raw output is byte-deterministic.

### T11 — Emit CropGraph identity and cultivation candidates (`validated`)

Emit qualified candidates for names, aliases, crop forms, cultivars, mixtures, windows, actions, anchors,
contexts, soil temperatures, harvest ranges, modifiers and notes. Preserve raw values and source notes. Keep
microgreens, mixtures and cultivar labels separate from generic mature-crop evidence.

Do not calculate French dates, infer greenhouse heating, infer action meaning or promote source notes to accepted
facts. Emit diagnostics for ambiguity and contradictions.

Dependencies: T5, T10.

Acceptance: tomato numeric/note disagreement, onion regional notes, ambiguous soil temperature, `plant_now`,
negative offsets, modifier lineage, absent citations and duplicate slugs all have fixture coverage.

Implemented by the CropGraph 0.2.0 importer with schema-validated identity and cultivation JSONL outputs.
The pinned cohort emits 17,032 identity and 41,916 cultivation candidates, all unreviewed with commercial
rights pending review. Fixtures cover semantic identity under reordering, conservative note diagnostics,
modifier bases and failure atomicity. The [adapter guide](source-adapter-guide.md#cropgraph-candidates-t11)
documents the extraction rules and limits; unresolved interpretation remains in the open questions register.

### T12 — Implement TAXREF extraction and localization candidates (`validated`)

Stream required TAXREF members while preserving `CD_NOM`, `CD_REF`, names, authorship, rank, parentage,
vernacular strings, territory/status codes and identifier changes. Validate duplicates, missing referents,
cycles and encoding. Emit French localization candidates with original strings, verified language fields,
territory context and exact locators.

TAXREF records are not used to replace WFO accepted names. Missing cultivated taxa are reported outcomes, not
evidence that a crop cannot exist.

Dependencies: T1 and T9.

Acceptance: fixtures cover accepted/synonym rows, homonyms, missing targets, parent cycles, duplicate IDs,
vernacular delimiters, encoding and removed identifiers. Malformed archives publish no partial output.

Implemented by the TAXREF 0.1.0 localization-staging importer. The pinned v18.0 run emits 708,685
taxonomic records, 82,966 vernacular records, 213,060 unreviewed French localization candidates, 68,761
change records, 12,891 removed identifiers and 78 vocabulary records. Eight parent identifiers absent from
the distributed taxonomy are retained as unresolved diagnostics; accepted-name referential failures, cycles,
duplicates, encoding errors and malformed records fail atomically. The importer preserves comma-delimited
vernacular strings without splitting them and does not attach TAXREF names to WFO identities. External database
links remain verified archive members but are not materialized by T12.

### T13 — Generalize WFO reconciliation for GROW and CropGraph

Replace the GROW-only seed interface with qualified GROW and selected CropGraph source-name seeds. Reconcile
against WFO using the existing conservative normalization. Preserve accepted, synonym, ambiguous, unplaced,
unresolved-status and unmatched outcomes. Keep cultivar and crop-form qualifiers visible.

Dependencies: T4, T7, T10–T11.

Acceptance: every selected source-name seed has one WFO outcome, including explicit no-match; existing GROW/WFO
fixtures remain valid; equal local IDs from different sources remain distinct.

### T14 — Link TAXREF localization to reviewed WFO identity

Use WFO-backed identity proposals as the starting point for TAXREF lookup. Emit `linked`, `ambiguous`,
`not-found` and `concept-disagreement` outcomes. Attach French-name proposals only to reviewed equivalent
links, retaining TAXREF identifiers and territory/status evidence.

Dependencies: T12–T13.

Acceptance: missing TAXREF data does not block WFO identity; disagreements become visible issues; localized names
cannot attach to the wrong crop form automatically.

### T15 — Generate integrated review packets

Generate a frozen, deterministic draft containing original GROW and CropGraph records, WFO identity outcomes,
TAXREF localization outcomes, cultivation candidates, existing authored decisions, rights evidence, scope
fingerprints and queue descriptors.

Packet grouping is provisional. Shared taxonomy does not imply a shared horticultural subject.

Dependencies: T4, T6, T7, T11, T13–T14.

Acceptance: unmatched records remain visible; shared taxa can have distinct crop forms; packet membership and
hashes are deterministic; changed dependencies invalidate the draft.

### T16 — Add comparisons to review packets

Compare GROW and CropGraph candidates by subject proposal, predicate, action, timing, geography and growing
system. Preserve agreement, conflict and non-comparability, including possible shared upstream evidence.

Dependencies: T6 and T15.

Acceptance: comparison output never discards either source claim or creates an implicit preference.

### T17 — Generalize read-only curation commands

Update draft generation, lookup, show, status and validation for the generalized V1 dataset and packet model.
Support explicit dataset and scope inputs, human-readable output and JSON output. Distinguish structural
validity, source-audit validity, localization coverage and editorial completion.

Dependencies: T7 and T15–T16.

Acceptance: clean-checkout structural validation needs no ignored archives; deep validation detects stale runs,
scopes, queues and packets; missing TAXREF localization does not appear as failed WFO identity.

### T18 — Generalize transactional decision application

Apply identity, subject, localization, context, assertion, comparison and issue decisions atomically. Pin the
draft, scope, dependencies, packets and candidate sets. Validate the complete prospective dataset, preserve
supersession and rollback, and expand batch decisions into individual records.

Dependencies: T17.

Acceptance: stale or corrupt input changes no tracked bytes; repeat application is idempotent or clearly
rejected; rejected and deferred candidates remain inspectable.

### T19 — Add coverage, integration verification and handoff

Report separate denominators for all 140 GROW records, the selected CropGraph cohort, MVP concepts and cultivar
exemplars. Account for WFO identity, subject scope, TAXREF localization, actions, contexts, rights, conflicts
and accepted limitations.

Run formatting, lint, typecheck, build, fixture tests, two deterministic local imports, failure-atomicity
checks, bounded-memory checks and clean-checkout/deep-audit rehearsals. Write the acquisition/import/review/
recovery runbook and define the handoff boundary to C5.

Dependencies: T18.

Acceptance: every selected source record and candidate is accounted for; repeated runs are byte-identical;
failed runs preserve the previous successful output; C5 receives only explicit reviewed authoring records.

## Explicit exclusions from this track

- No second TAXREF identity backbone.
- No V2 schema or permanent legacy compatibility layer.
- No automatic acceptance of WFO, TAXREF or cultivation candidates.
- No French climate-date calculation or US zone transfer.
- No consumer JSONL.gz release construction.
- No companion, pest, rotation, succession or GDD-model curation beyond inventory and explicit exclusion.
- No database, editorial HTTP service or mandatory external API.

## Main-track status

The existing GROW/WFO implementation is the starting point and regression base. The former broad P1–P7 plan,
including its two-backbone identity model and combined source-preparation milestones, is retired. Progress is
tracked only through T1–T19 in this document.
