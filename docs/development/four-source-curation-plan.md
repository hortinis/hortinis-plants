# GROW, WFO, TAXREF and CropGraph import and curation plan

- Status: planned
- Planning date: 2026-09-16
- Scope: reproducible source staging and one integrated editorial pass across all four sources
- Excludes: automatic acceptance, production publication, climate-grid construction and live recommendations

## Outcome

A curator opens one crop review packet and sees GROW and CropGraph claims alongside WFO and TAXREF
identity proposals, French/English name candidates, contexts, rights evidence and unresolved differences.
They can author the identity, subject, names, contexts and individual assertion decisions in one atomic
transaction. Shared taxonomy decisions can be reused across packets without merging crop forms.

“One pass” means all relevant evidence is available together before substantive curation starts. It does
not promise that ambiguous evidence can be resolved immediately: explicit deferrals and missing-source
limitations remain visible. Adapter reruns never accept data or undo reviewed decisions.

This plan extends the existing GROW/WFO workflow rather than building four independent curation silos.
Its implementation precedes the broad editorial steps C4.6–C4.8 in the existing workflow plan. The
already validated C4.1–C4.5 capabilities remain requirements and regression coverage.

## Scope and source pins

| Source    | Planned input                                                       | Role                                                                               |
| --------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| GROW      | Existing pinned 2020 release and source manifest                    | Cultivation claims, common names and source locations                              |
| WFO       | Existing pinned 2026-06 backbone                                    | Global botanical identity, accepted names and synonyms                             |
| TAXREF    | Proposed v18.0 archive, published 2025-01-09                        | French taxonomy crosswalks, vernacular names and source-qualified territory status |
| CropGraph | Commit `e722c3415bcf2773277f3422e13a4de5efd29b48`, calendar fixture | Crop forms, names, frost-relative actions and cultivation candidates               |

TAXREF-Web identifies v18.0 as the downloadable release at planning time. Verify archive contents,
official distribution URL, licence evidence, size and SHA-256 during source preparation. If availability
requires a different version, record the choice before implementation; do not replace it with live API
results or an unrecorded mirror. CropGraph's commit is the inspected baseline, not a floating `main` pin.
Neither new source has a completed repository manifest yet.

Import the full CropGraph calendar into ignored staging for discovery and accounting. Freeze an explicit
curation scope: retain all 140 GROW records and select CropGraph records relevant to those horticultural
subjects and the ADR-0005 MVP. Prioritize the 33 MVP concepts and two tomato exemplars in the same workflow.
Do not require review of all 5,006 CropGraph entries to complete this cohort. Every excluded record must
have a scope disposition; absent exemplar data must be reported, not invented. The exact selection list
is a preparation deliverable, with identifiers, rationale and a fingerprint, not an importer heuristic.

Companions, pests, rotation, succession, beneficial insects and GDD model files are later cohorts. The
initial importer inventories these exclusions but does not expand the MVP or build their contracts.

## Architecture and dependencies

```text
Pinned GROW resources ──> existing source adapter ──┐
                                                 ├─> qualified source-name seeds
Pinned CropGraph calendar ──> new source adapter ──┘           │
                                                             ├─> WFO reconciliation
Pinned WFO archive ───────────────────────────────────────────┘
                                                             │
Pinned TAXREF archive ──> taxonomy extraction ────────────────> TAXREF reconciliation
                                                             │
Reviewed/manual identity proposals + bounded synonym expansion│
                                                             v
                    frozen four-source review manifest and crop packets
                                                             │
                    explicit decisions ──> transactional apply
                                                             │
                    tracked authoring dataset + validation + coverage report
```

Keep one-source adapters on the shared importer runner. Reconciliation and packet generation consume
multiple pinned outputs and use separate manifests. Every dependency includes release, configuration and
content fingerprints. Store large archives and generated outputs in ignored `.cache` paths; commit only
source metadata, small test fixtures, scope configuration and curator-owned authoring records.

Use Node.js 24, TypeScript, pnpm, JSON Schema 2020-12, Ajv and Vitest. Stream large ZIP/TSV inputs and
CropGraph's entries array, using bounded selected-name/ID indexes and multiple passes where necessary.
Do not add a database, mandatory external API or runtime HTTP service.

## P1 — Shared contracts and migration design

- Status: planned
- Dependencies: existing GROW/WFO implementation

Audit `src/curation/grow-wfo-*`, WFO input types, schema registry and semantic validation for assumptions
about one source or one taxonomy. The current manifest hardcodes GROW/WFO baseline fields and exactly 17
collections; some maps use `sourceRecordId` alone. Replace these assumptions deliberately.

Required contracts:

- Qualified source-record key: source, release, record identifier, with the exact manifest reference.
  Candidate identity additionally names the source field or semantic subrecord. Array positions may be
  evidence locators but never catalog IDs. Duplicate source slugs/IDs fail; repeated botanical names do not.
- Generic input-run descriptors, frozen scope descriptor and hashed queue/packet descriptors.
- Independent reconciliation outcomes for each source record against each taxonomy. A selected WFO
  interpretation must not hide an unresolved TAXREF interpretation, or vice versa.
- Preserve existing record-specific name/subject decisions; add separate taxonomy-target decisions where
  needed so two backbones do not require duplicating or overwriting the same source-name decision.
- Reviewed crosswalk relation semantics: equivalent botanical concept versus broader/narrower or
  unresolved relation. The existing crosswalk assumes a shared taxon; do not force unequal concepts into
  it. Non-equivalent proposals remain issues unless an explicit extended relation contract is approved.
- Explicit authored action and typed timing for CropGraph windows. Existing `cultivation_window` only
  supports `harvest`/`establish_outdoors` and absolute calendars; extend the authoring contract through
  reviewed schemas rather than hiding action data in arbitrary JSON or misusing `sowing_window`.
- Assertion comparison records/decisions that preserve agreement, conflict, non-comparability and an
  explicit preferred projection or deferral. No implicit source priority or averaging.

Retain one catalog display accepted name per taxon while preserving each backbone's own accepted-name
relationship. WFO and TAXREF can disagree on names without either source record being rewritten. Confirm
the display-name policy and non-equivalent concept handling in the open questions register before coding
their dependent rules.

Plan explicit authoring/draft schema version changes. Existing v1 validation remains available; old
transactions must not be interpreted as new transactions. Migrate the existing authoring directory in
place to a generic dataset identity unless an explicit later move is documented. Preserve authored IDs,
reviews, history and decision links. If it is still empty, verify that fact at migration time. Never reset
populated collections. Keep existing commands as documented compatibility entry points for the old
workflow; new generic commands must identify their dataset and baseline unambiguously.

Acceptance: contract examples cover two sources with the same local record ID, two taxonomy outcomes for
one record, shared taxa with distinct crop forms, and a versioned migration that preserves existing data.

## P2 — Source preparation and reproducible acquisition

- Status: planned
- Dependencies: P1 source/run contracts

Create `data/sources/taxref/` and `data/sources/cropgraph/` with source, licence, manifest and README records.
Record official URLs, immutable release/commit identifiers, exact resources and members, media types,
byte sizes, hashes, citation, extraction method and exclusions. Separate download/preparation from offline
import. Verify resource fingerprints before opening parsers; preserve the previous successful run on error.

CropGraph's calendar declares CC BY 4.0; its code licence is separate. File-level bibliography is acceptable
input evidence and must be inherited explicitly when an entry has no citation. Preserve entry overrides,
citation granularity and the complete file bibliography. Do not fabricate per-claim citations. Shared
rights reviews can cover explicitly enumerated records; file-level declaration alone does not settle
upstream rights. Unresolved rights prevent consumer eligibility, not inspection of staged candidates.

TAXREF acquisition must include the selected release's documentation and code lists. Inventory the
actual archive before fixing member names: taxonomy, vernacular names, external links, change history and
removed-name mappings may have different formats. No assumption that a WFO link exists in TAXREF.

Acceptance: source manifests verify exact local inputs; offline reruns work; unavailable downloads have
actionable errors; corruption cannot replace a prior successful run.

## P3 — CropGraph adapter and field policy

- Status: planned
- Dependencies: P1–P2

Implement `src/adapters/cropgraph/` and `import:cropgraph`. Emit raw source records, name/subject candidates,
assertion candidates, exclusions, diagnostics and attribution through the shared runner. The source slug
is a source identifier, never the new Hortinis identifier. Retain cultivar labels, mixtures and production
uses separately from scientific-name strings. Do not classify a microgreen as generic mature-crop evidence.

| Field                                       | Staging and curation treatment                                                                                                                              |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scientificName`, `commonName`, `aliases`   | Identity/name proposals; preserve raw spelling and language uncertainty                                                                                     |
| `windows`                                   | Separate candidate per action, anchor and source window; preserve notes and negative offsets                                                                |
| `last_spring`, `first_fall`                 | Propose `last_spring_frost`, `first_autumn_frost`; document exact vocabulary mapping                                                                        |
| `start_indoors`, `direct_sow`, `transplant` | Preserve explicit actions; `plant_now` proposes `plant` only after meaning review                                                                           |
| `growingContext`                            | Retain outdoor/indoor/both/greenhouse; greenhouse does not imply unheated shelter                                                                           |
| `minSoilTempF`                              | Preserve raw value and convert by `(F - 32) * 5 / 9` under a documented precision policy; do not decide germination versus transplant meaning automatically |
| `daysToHarvest`                             | Preserve range; defer promotion until sowing/transplant/establishment and harvest target are explicit                                                       |
| `season`, `zoneRange`                       | Preserve source qualifiers; not numeric frost thresholds or proof of French suitability                                                                     |
| `climateModifiers`                          | Separate derived proposals with base-window and modifier lineage; weeks convert to days; notes-only modifiers stay notes                                    |
| `notes`                                     | Retain evidence, surface contradictions; do not automatically extract accepted horticultural facts                                                          |

Reordering a source window must not silently change its identity; use a documented semantic/content key
within the qualified source record and an explicit duplicate policy. Values that change across releases
produce new candidates and a review diff, never silent updates to accepted assertions.

Do not import CropGraph's US frost-date table or coordinate climate classifier into France applicability.
Do not generate calendar dates during import. Preserve the source's North American applicability and
require a reviewed decision for any wider applicability. Base and modified rules must not both apply
without explicit selection/override semantics. A modifier affecting the same action in spring and autumn
must expose both resulting proposals for review.

Acceptance: inspected-source fixtures include tomato's numeric/note disagreement, ambiguous soil
temperature meaning, onion regional/photoperiod notes, absent citations, absent contexts, malformed
windows, duplicate slugs, cultivar scope and deterministic byte output. All candidates stay unreviewed.

## P4 — TAXREF adapter and lookup

- Status: planned
- Dependencies: P1–P2

Implement `src/adapters/taxref/`, `import:taxref` and a read-only pinned lookup. Stream the official archive;
preserve `CD_NOM`, `CD_REF`, scientific names/authorship, rank, parentage, vernacular names and documented
territory/status codes as available. Treat external numeric identifiers as strings. Preserve individual
name rows and accepted-target links; never replace `CD_NOM` with `CD_REF` and lose the original name.

Extract relevant matches, accepted targets, synonyms and genus/family closure. Keep national or overseas
status as source-qualified information, not a filter that removes potential cultivated-plant matches.
Preserve metropolitan and other territory distinctions; presence is not cultivation suitability. Missing
cultivated taxa/cultivars are expected review outcomes, not evidence that the crop cannot exist in Hortinis.

Vernacular strings become language-tagged proposals only according to the documented fields; split lists
only using verified delimiters, retaining original strings. Do not mark every French name preferred or
attach a species name automatically to every crop form. Retain external-link and name-change evidence
where available; retired identifiers require explicit replacement/supersession review.

Acceptance: fixtures cover accepted and synonym names, homonyms/authorship, ranks, missing accepted
targets, parent cycles, duplicate IDs, encoding, vernacular names, status code interpretation and removed
IDs. Missing required referents or malformed archives fail without publishing partial output.

## P5 — Shared identity reconciliation

- Status: planned
- Dependencies: P3–P4

Replace the GROW-only WFO seed interface with qualified seeds from the frozen GROW/CropGraph cohort.
Reconcile both sources independently against WFO and TAXREF. Compare preserved source names first, then
record any proposal supported by selected accepted names, synonyms or verified external links. Fingerprint
the seed set and any bounded expansion; keep evidence of every matching step and terminate cycles.

Exact matches remain proposals. Rank/authorship conflicts, multiple candidates, mixtures, cultivar-group
labels, misspellings, synonyms and differing taxonomic concepts produce explicit review outcomes. Fuzzy
search may assist manual lookup but cannot automatically accept or replace a name. Do not strip cultivar
or group qualifiers and silently widen a horticultural subject to the resulting species.

Provisional packet grouping may use reconciled taxonomy and explicit scope-selection links. It is not a
canonical subject merge. Keep unmatched records discoverable and allow a curator to split, join or reassign
packets with recorded reasons. Preserve a generic plant, its cultivar groups and its cultivars separately.

Acceptance: every selected GROW/CropGraph record has outcomes for both backbones, including explicit
no-match. Shared crosswalk proposals deduplicate only by external source/release/identifier. A match in
one backbone cannot hide ambiguity or a split/lump disagreement in the other.

## P6 — Integrated review packets and transactional decisions

- Status: planned
- Dependencies: P1, P3–P5

Provide generic `curate:catalog:drafts`, `show`, `status`, `validate` and `apply` commands (planned names,
not currently available scripts), with explicit dataset/scope parameters and JSON output. Add pinned
TAXREF lookup alongside WFO lookup. Produce a readable per-packet report and machine-readable transaction
template; no interactive web service is needed.

Each packet must include:

1. Original records, all provenance and proposed grouping, plus existing authored decisions.
2. WFO and TAXREF alternatives side by side, ranks, authorship, synonym chains and concept disagreements.
3. Proposed taxon, crop form/group/cultivar scope, French/English names and explicit missing coverage.
4. GROW and CropGraph assertions arranged by predicate, action, stage, timing type, geography and system.
5. Rights/citation context, ambiguities, non-comparable values and proposed normalization details.
6. Individual accept/reject/defer actions and unresolved issues with reasons; no preselected acceptance.

Absolute Bordeaux calendar dates and frost-relative rules are not numeric contradictions until a separate
climate evaluation makes them comparable. Overlapping values are not automatically corroboration; retain
possible common upstream sources. Accepted claims from different sources remain separate assertions.

Apply validates the complete prospective dataset and all affected packets before atomic publication.
Transactions pin the draft, scope and dependency fingerprints and enumerate all affected candidate IDs.
Batch review must expand into individual decisions with frozen counts/hashes. Preserve idempotence,
rollback, explicit supersession and global shared-crosswalk consistency. A changed source produces a
review diff; it never silently carries approvals forward. Content and rights decisions remain separate.

Acceptance: one transaction can review a crop across all four sources; a stale/corrupt transaction makes
no changes; a shared taxon update detects affected packets; rejected/deferred candidates are inspectable.

## P7 — Readiness, coverage and handoff

- Status: planned
- Dependencies: P6

Distinguish structural validity, source-audit validity, editorial completion and release eligibility.
The scoped readiness report must account for every selected source record and candidate and separately
count records outside scope. Report identity outcomes by backbone, reviewed mappings, localization,
actions, temperature semantics, cultivar scope, geography/system, unresolved conflicts and rights.

Report MVP coverage against 33 generic concepts and two cultivar exemplars; report the full GROW cohort
and selected CropGraph cohort with their own explicit denominators. Deferred required evidence is not
complete recommendation coverage. A missing TAXREF match can be an accepted limitation if documented;
it must not fabricate an external identifier or disappear from the coverage report.

Required verification:

- Fixture-only CI: schema conformance, semantic checks, migration, source-ID collisions, two-backbone
  disagreements, scope boundaries, action/anchor/unit preservation, deterministic reruns and failed-run
  atomicity. Run repository format, lint, typecheck, Vitest and build checks.
- Clean-checkout authoring validation without downloads; deep audit against all four local pinned runs.
- Full local import of pinned sources twice, comparing output hashes/counts and verifying memory remains
  bounded. Save generated audit reports outside Git; document the commands and outcomes.
- End-to-end fixture rehearsal for tomato, a brassica crop form, a synonym/name change, an unmatched
  cultivar and two GROW/CropGraph records sharing a taxon but not a horticultural subject.
- Read-only full-data packet rehearsal that verifies all sources appear before asking the curator to
  begin production decisions. Fixtures never supply production IDs or accepted facts automatically.

Deliver a runbook with acquisition, import order, scope freezing, packet review, apply, validation,
recovery and release-update procedures. C5 receives reviewed authoring records and unresolved limitations;
this work does not publish a release. French frost statistics and live weather remain separate climate
and application work, not prerequisites for reviewing source-native relative rules.

## Suggested implementation batches and effort

| Batch | Deliverable                                         | Estimated active developer time |
| ----- | --------------------------------------------------- | ------------------------------- |
| P1    | Contracts, compatibility and migration fixtures     | 2–3 days                        |
| P2–P3 | Source preparation and CropGraph staging            | 2–3 days                        |
| P4    | TAXREF staging, names and pinned lookup             | 2–3 days                        |
| P5    | Both-source/both-backbone reconciliation            | 2–3 days                        |
| P6    | Integrated packets, comparison and atomic decisions | 3–5 days                        |
| P7    | Coverage, integration audit and runbook             | 1–3 days                        |

Budget 12–20 active developer days for curation-ready tooling, not completed botanical/horticultural
curation. This exceeds a standalone TAXREF importer estimate because it replaces source-specific workflow
assumptions and adds shared review/migration guarantees. Refine after P1 and archive inspection. External
download outages or unresolved domain decisions can extend elapsed time. Validate the pilot before
estimating editorial effort for the entire cohort.

## Decisions to resolve before dependent implementation

See [the open questions register](../open-questions.md#four-source-import-and-integrated-curation).
Record the outcome of each there; an importer must not settle them implicitly. Proposed defaults in this
plan are implementation recommendations, not already validated editorial policy.

## Evidence used for planning

- [TAXREF-Web release and citation](https://taxref.mnhn.fr/taxref-web/).
- [PatriNat official temporary download page](https://www.patrinat.fr/fr/page-temporaire-de-telechargement-des-referentiels-de-donnees-lies-linpn-7353).
- [TAXREF scope](https://taxref.mnhn.fr/taxref-web/about).
- [Inspected CropGraph calendar](https://github.com/Cropgraph/cropgraph/blob/e722c3415bcf2773277f3422e13a4de5efd29b48/packages/core/src/data/crop-calendar.json).
- [CropGraph calendar implementation](https://github.com/Cropgraph/cropgraph/blob/e722c3415bcf2773277f3422e13a4de5efd29b48/packages/core/src/crop-calendar.ts).
- [CropGraph US frost lookup](https://github.com/Cropgraph/cropgraph/blob/e722c3415bcf2773277f3422e13a4de5efd29b48/packages/core/src/usda-zones.ts).
- [CropGraph climate classifier](https://github.com/Cropgraph/cropgraph/blob/e722c3415bcf2773277f3422e13a4de5efd29b48/packages/core/src/climate-types.ts).
