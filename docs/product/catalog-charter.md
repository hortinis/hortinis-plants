# Catalog charter

- Status: planned
- Authority: Hortinis ADR-0005 (external plant catalog) and ADR-0014 (plant catalog distribution contract)

## Purpose

Provide versioned, explainable plant reference data for offline applications. It is reusable independently of Hortinis and excludes personal garden data.

## Initial product scope

The first profile covers the 33 vegetables and herbs selected in ADR-0005, grown outdoors or in unheated shelters in metropolitan France, including Corsica. It supports cold-risk and sowing/planting-window recommendations for crops already selected by the gardener.

It includes `Marmande` and `Montfavet H 63-5 F1` as initial cultivar exemplars but does not promise complete cultivar coverage. It does not include live weather, disease diagnosis, crop discovery, companion planting, rotations, images or medicinal advice.

## Ownership boundary

The catalog owns plant identity, cultivation parameters, applicability, evidence, provenance, licence and confidence. Hortinis owns garden state, observations, weather, recommendation rules, scoring, explanations, lifecycle and overrides.

## Profiles

- `fr-mvp`: the reviewed MVP plant set and required rules;
- `fr-rich`: broader France coverage and additional reviewed relationships;
- `global-core`: global taxonomy and generally reusable traits;
- optional regional or image packs, each with its own licence manifest.

The first release implements localized names in French and English with explicit language tags and deterministic fallback. Neither language is a completeness claim about every source record.
