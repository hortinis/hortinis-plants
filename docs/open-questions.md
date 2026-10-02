# Open questions

The former release and coordination questions are resolved by ADR-0004 through ADR-0006. The C1.2b
foundation tooling choices are resolved in [the implementation plan](development/implementation-plan.md).

## Deferred choices

- Exact source-backed values and broader coverage beyond the V1.2 `dev-validation` fixture.
- Cultivar-level timing at scale.
- Pest and disease recommendations.
- Companion planting, rotation and succession.
- Perennial and tree lifecycle data.
- Community contribution and public editorial workflow.
- Exact scope, source policy and delivery contract for optional image packs.
- Climate-cell resolution, sources, reference period and contract in the planned separate `hortinis-climate` repository.
- Artifact signing and key rotation if a future threat model requires authenticity beyond trusted local selection or authenticated HTTPS.

## WFO snapshot and taxonomy scope

- **in progress:** The 2026-06 Zenodo archive publishes MD5 and exact byte size, but no SHA-256 in its
  file metadata. The WFO adapter verifies the published MD5 and size and independently records the
  computed SHA-256 in its run manifest. Revisit the source pin if Zenodo or WFO publishes a stronger
  release checksum.
- **in progress:** Before producing a consumer `global-core` taxonomy projection, confirm whether its
  WFO-derived subset should remain limited to reviewed external crosswalks plus accepted-name/synonym
  and genus/family closure, or include additional higher-rank ancestors and non-GROW catalog seeds. The
  current staging adapter is seeded by GROW and the selected CropGraph cohort and does not resolve this
  consumer-scope choice.

## GROW adapter

- **validated:** Scope each GROW calendar claim to the country named by its source calendar location. Preserve the named location and associated strata in the evidence, but do not claim a distinct climate-region or strata scope without a later documented decision. Normalize the source label `Irland` to `Ireland` while retaining the original label in provenance.
- **validated:** Preserve `Sow outdoors / plant out` as a combined, source-native action. Where the source context supports it, represent it as `establish_outdoors` with propagation `direct_sowing_or_transplant`; retain the original source field. Never split it into direct sowing or transplanting. Recommendation logic must abstain when it needs that distinction.
- **validated:** Retain parsed `Length of gorwing to harvest` values as unreviewed source candidates. Do not normalize or project them to consumer-facing harvest duration until a source-backed anchor is available.
- **in progress:** Review plant identity mappings for crop forms and repeated taxa before converting GROW source IDs into catalog subject IDs. Unmapped rows remain source records and candidates.
- **validated:** Use Celsius (`Cel`) for GROW temperature data. Preserve source values and model reported minimum, maximum and optimum only when supplied; ranges labelled optimum/ideal are bands, not absolute survival limits.
- **validated:** Map GROW temperature classes to qualitative frost sensitivity without inventing a numeric threshold: `Very tender` and `Tender` to `sensitive`; `Half hardy` to `unknown`; and `Hardy`, `Very hardy`, and normalized `Very hard` to `hardy`. Retain the original class and normalization method in provenance. Exclude `Not applicable.`.
- **validated:** Apply CC BY 4.0 to the GROW dataset package based on the University of Dundee record at DOI `10.15132/10000157`; exclude separately licensed images and generate attribution with an adaptation notice.

## Authoring-to-consumer projection

- **in progress:** A `sowing_window` assertion must not be projected to `start_indoors` or `direct_sow` unless the source and reviewed context identify that action. Keep ambiguous source claims in authoring/candidate data; do not infer an action.
- **in progress:** Define the authoring representation for GROW's combined `indoors_or_undercover`
  calendar action before accepting any of those candidates. Until then, record-level decisions must defer
  them; they must not be silently projected to `start_indoors`, `direct_sow` or a particular shelter type.
- **validated:** Retain `taxon.scientificName` in the V1 authoring model as a stored convenience value and
  require it to equal the taxon's single active accepted `taxonomic-name`. Reconsider removing the stored
  value only through a later contract decision; C5 must not choose between disagreeing values.
- **in progress:** Before the first production C4 subject record is authored, decide whether any stable
  identifier from the `dev-validation` fixture is deliberately promoted to canonical use. The workflow
  must not reuse fixture identifiers or evidence automatically.

## Four-source curation main track

The [four-source curation main track](development/four-source-curation-plan.md) is now the active
implementation sequence. The previous two-backbone and schema-version questions are retired.

- **validated — Authority:** WFO is the botanical identity backbone and default catalog display-name source.
  TAXREF is primarily a French localization and territory/status enrichment source.
- **validated — Contract evolution:** update the existing V1 contracts in place; do not create a V2 schema or
  permanent legacy-compatibility branch while the project remains in development.
- **validated — CropGraph source pin:** commit `e722c3415bcf2773277f3422e13a4de5efd29b48`, its calendar,
  matching schema and licence evidence are pinned with exact checksums. Code and data licence scopes remain
  distinct; the calendar is pending assertion-level rights review for commercial use.
- **validated — TAXREF pin and licence:** v18.0 is pinned with its bundled methodology, all nine archive members
  and per-member checksums. TAXREF's terms allow reuse and redistribution under the Open Licence with citation;
  commercial eligibility is recorded with attribution. The publisher does not name a numbered licence version.
- **validated — TAXREF localization extraction:** preserve complete taxonomy, vernacular, change, removed-ID and
  vocabulary staging records. Emit French candidates only from the documented `NOM_VERN` field or agreeing
  `LANGUE=Français` and `ISO639_3=fra` markers. Keep delimiter-separated strings unsplit, `PAYS` unnormalized,
  and synonym evidence attached to its original `CD_NOM`. The eight v18 parent gaps are unresolved diagnostics;
  broken accepted-name references and graph cycles are fatal.
- **validated — TAXREF external-link boundary:** verify `TAXREF_LIENS.txt` as part of the complete archive pin but
  do not materialize its 2,016,747 rows in T12. T14 uses a separately scoped extraction contract that streams
  only rows whose `CT_NAME` is exactly `WFO (World Flora Online)` and whose WFO identifier is in the reviewed
  crosswalk input. Other external database mappings remain outside the localization contract.
- **in progress — T14 WFO identifier versions:** T14 requires exact WFO identifier equality. Identifiers such as
  `wfo-0000449318-2022-06` are not silently reduced to `wfo-0000449318`; they remain visible as unresolved or
  disagreement evidence until a release-aware equivalence rule is explicitly reviewed.
- **validated — T14 proposal boundary:** a `linked` T14 outcome is generated review material, not editorial
  acceptance. French proposals remain `unreviewed` and target only the reviewed Hortinis taxon. Applying a
  preferred localized name or attaching it to a crop form belongs to later curation decisions.
- **validated — CropGraph cohort:** include all 5,006 pinned calendar entries for raw staging, with zero
  entry exclusions. The explicit slug list and fingerprint are frozen in `data/sources/cropgraph/cohort.json`;
  subject matching is deferred to curation.
- **planned — CropGraph semantics:** preserve ambiguous soil-temperature meaning, greenhouse context,
  `plant_now`, unknown name languages and harvest-duration anchors as candidates or deferred decisions. Do not
  infer meanings during import.
- **planned — Geographic transfer and modifiers:** do not convert North American frost data into French dates;
  preserve source-relative rules and require explicit review for applicability and base/modifier selection.
- **validated — Comparison contract:** preserve agreement, conflict and non-comparability; require an explicit
  preferred assertion, retain-both decision or deferral; do not average values or apply source priority
  implicitly. Packet matching and completion coverage remain planned for T16 and T19.

- **validated — CropGraph candidate identity:** use qualified semantic content keys, collapse exact nested
  duplicates into one candidate with every occurrence locator, and keep differing notes as distinct claims.
  Source array positions never determine candidate identity.
- **validated — CropGraph extraction boundary:** explicit label hints and the bounded diagnostic patterns in
  the [adapter guide](development/source-adapter-guide.md#cropgraph-candidates-t11) preserve unreviewed source
  claims. Unrecognized labels and prose remain unresolved rather than being interpreted automatically.
- **planned — CropGraph broader label and prose interpretation:** resolving cultivar names without explicit
  quoted epithets, crop-form equivalence, mixture components, alias languages and additional note patterns
  requires later curation. The T11 extractor does not establish these meanings.
- **validated — Integrated packet grouping:** T15 groups packets by qualified source record as a provisional
  review boundary. Shared WFO taxonomy is retained as a cross-packet reference; deciding whether records
  share a horticultural subject remains an explicit T16/T18 review decision.
- **validated — T16 comparison proposals:** a shared unambiguous WFO accepted identifier plus equal normalized
  source common names nominates a GROW–CropGraph packet pair for comparison. It does not establish subject
  equivalence or source independence. Different crop-form names are not paired automatically; unpaired claims
  remain available for explicit review. GROW calendar dates and CropGraph frost-relative windows remain
  non-comparable without an approved geographic and timing model.
- **validated — T17 scope inputs:** the authored CropGraph cohort selects importer records; the frozen
  integrated review scope describes the resulting packets and input fingerprints. An explicit frozen scope
  must match, and cannot silently narrow a run. Structural validation remains independent of both cached
  packets and source archives.
- **validated — T17 baseline hashing:** integrated drafts hash authoring manifests and collections; their
  hash is not inserted back into the manifest. Configuration, source/run and scope pins stay independent,
  while assertion/comparison decisions retain exact draft hashes. The historical GROW/WFO draft baseline
  remains limited to that workflow until T18 replaces transactional application.
- **validated — T17 localization denominator:** count unique current reviewed WFO crosswalks used by reviewed
  source-name decisions in the selected scope. Distinguish records not yet eligible, eligible identities
  not reconciled and actual TAXREF outcomes. Do not count generated proposals as accepted localized names.
- **validated — T18 authoring transition contract:** the first integrated transaction explicitly declares
  CropGraph/TAXREF dependencies, editorial scope and the packet-decision collection. Audit original authoring
  snapshots before staging and validate the prospective dataset against frozen candidates afterward. Keep
  integrated draft/scope/authoring hashes out of manifest baselines. Replays and transaction ID reuse are
  rejected; the consumed draft remains stale. See [the integrated workflow](development/integrated-curation.md).
- **validated — T18 decision history:** immutable packet decisions preserve accepted, rejected and deferred
  dispositions, candidate/comparison snapshots, rights evidence and review lineage. Domain decisions retain
  explicit supersession. Issue-state and localized-name preference replacements require an exact previous
  content digest and preserve the previous value. Historical approvals retain their original hashes and do
  not automatically qualify for completion accounting against a newer draft.
- **planned — Tracked four-source editorial admission:** select the actual dataset scope and supply the
  reviewed first manifest transition when applying four-source curation. T18 tooling and fixture validation
  do not admit real source dependencies, merge subjects or accept source candidates by themselves.
- **planned — T19 completion policy:** define aggregate C4 readiness, required localization and how reviewed
  deferrals or accepted limitations affect delivery coverage. T17 reports reviewed dispositions separately
  from accepted facts and leaves unresolved identity decisions pending.
