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
- Hortinis coordination on schema compatibility guarantees, minimum-consumer enforcement and migration fixtures.
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
  value only through a later schema-version decision; C5 must not choose between disagreeing values.
- **in progress:** Before the first production C4 subject record is authored, decide whether any stable
  identifier from the `dev-validation` fixture is deliberately promoted to canonical use. The workflow
  must not reuse fixture identifiers or evidence automatically.

## Four-source import and integrated curation

Implementation sequence and acceptance criteria are in the
[four-source plan](development/four-source-curation-plan.md). The following choices are `planned` and
must be recorded before their dependent implementation; proposed defaults are not validated decisions.

- **planned — Source pins and cohort:** Verify TAXREF v18.0 archive members, distribution URL, rights
  evidence and checksums; confirm the inspected CropGraph commit. Freeze explicit CropGraph source IDs
  relevant to the full GROW cohort and ADR-0005 MVP, including unmatched or missing exemplar outcomes.
  Full calendar staging must not make all CropGraph entries mandatory editorial work.
- **planned — Two-backbone identity policy:** Confirm the catalog display accepted-name authority
  (proposed: retain WFO as the default, preserve TAXREF's independent accepted-name relationship), and
  how differing taxonomic concepts are represented. Never assert equivalent crosswalks for a broader
  or narrower concept merely because its name matches. Define independent per-backbone dispositions.
- **planned — Authoring contract evolution:** Choose explicit schema versions and migration for generic
  source/run manifests, taxonomy-target decisions, action-bearing relative-window assertions and
  comparison dispositions. Preserve old v1 validation, authored identifiers and review history.
- **planned — CropGraph semantics:** Decide the authoring representation of soil temperature when its
  germination/transplant role is uncertain, greenhouse versus unheated shelter, `plant_now`, unknown
  name languages and harvest-duration anchors. Define deterministic temperature precision. Until
  supported, retain raw candidates and defer the affected assertion, not unrelated crop review.
- **planned — Geographic transfer and modifiers:** Define evidence/review requirements for accepting
  North American frost-relative rules in France, and explicit selection/override behavior for base versus
  climate-modified rules. No US zone-to-frost-date table or coordinate heuristic is France evidence.
- **planned — Comparison and completion:** Define explicit handling of competing eligible claims for
  later C5 projection and which accepted limitations allow scoped C4 completion. Preserve all claims;
  do not average, rank sources implicitly, or call deferred required MVP evidence complete coverage.
