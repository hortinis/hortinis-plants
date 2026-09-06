# Validation and release

## Required checks

1. JSON Schema validation.
2. Identifier and referential-integrity checks.
3. Taxonomy reconciliation and synonym checks.
4. Unit, range and context validation.
5. Licence and attribution gates.
6. Duplicate and contradiction reports.
7. Deterministic-build comparison.
8. Recommendation conformance fixtures.
9. Bundle-size and streaming-import checks.

## Acceptance criteria

- No forbidden or unknown rights enter a commercial profile.
- Every released assertion has a source release and locator.
- Retired records remain resolvable.
- Two clean builds produce identical chunk hashes.
- A corrupted or incomplete artifact cannot become active in Hortinis.
- French MVP fixtures cover representative maritime, continental and Mediterranean contexts.
- Missing context produces an explicit limitation or abstention rather than an invented recommendation.

The first rich France release is expected to be 8–15 MB compressed without images. Set the exact budget after measuring the first profile on target PWA devices.
