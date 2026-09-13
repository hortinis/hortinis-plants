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

## GROW adapter

- **In progress:** Define whether each GROW calendar location represents only its named coordinates or can support its associated source strata, then map those source scopes to Hortinis geographic contexts. Until resolved, retain only the source location/strata context and do not widen assertions.
- **Validated:** Preserve `Sow outdoors / plant out` as a combined, source-native action. Do not infer direct sowing or transplanting. Keep it as a source candidate until the catalog contract can represent the combined meaning; recommendation logic must abstain when it needs the distinction.
- **In progress:** Define the source anchor for `Length of gorwing to harvest` before normalizing it to a consumer-facing harvest duration. Preserve parsed days only as an unreviewed source candidate.
- **In progress:** Review plant identity mappings for crop forms and repeated taxa before converting GROW source IDs into catalog subject IDs. Unmapped rows remain source records and candidates.
- **Validated:** Use Celsius (`Cel`) for GROW temperature data. Preserve source values and model reported minimum, maximum and optimum only when supplied; ranges labelled optimum/ideal are bands, not absolute survival limits.
- **Validated:** Apply CC BY 4.0 to the GROW dataset package based on the University of Dundee record at DOI `10.15132/10000157`; exclude separately licensed images and generate attribution with an adaptation notice.
