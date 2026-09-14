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
- **in progress:** Decide whether `taxon.scientificName` remains a stored convenience value constrained to
  equal the active accepted `taxonomic-name`, or becomes a C5-derived projection. C4 must author accepted
  and synonym taxonomic-name records either way and must not allow the two representations to disagree.
- **in progress:** Before the first production C4 subject record is authored, decide whether any stable
  identifier from the `dev-validation` fixture is deliberately promoted to canonical use. The workflow
  must not reuse fixture identifiers or evidence automatically.
