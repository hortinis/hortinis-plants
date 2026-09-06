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
10. Localization-tag, preferred-name and deterministic-fallback checks.

## Acceptance criteria

- No forbidden or unknown rights enter a commercial profile.
- Every released assertion has a source release and locator.
- Retired records remain resolvable.
- Two clean builds produce identical chunk hashes.
- A corrupted or incomplete artifact cannot become active in Hortinis.
- French MVP fixtures cover representative maritime, continental and Mediterranean contexts.
- French MVP fixtures also cover a mountain context and explicitly represent Corsica within metropolitan-France scope.
- Generic tomato remains usable without a cultivar; cultivar-scoped facts for `Marmande` and `Montfavet H 63-5 F1` never leak into the generic projection.
- French and English preferred-name coverage is reported, and missing translations fall back without inventing or relabeling a name.
- Missing context produces an explicit limitation or abstention rather than an invented recommendation.

The first rich France release is expected to be 8–15 MB compressed without images. Set the exact budget after measuring the first profile on target PWA devices.
