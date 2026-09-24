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
  current staging adapter is intentionally GROW-seeded and does not resolve this consumer-scope choice.

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
