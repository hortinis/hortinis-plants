# Catalog charter

- Status: planned
- Authority: Hortinis ADR-0005 (external plant catalog) and ADR-0014 (plant catalog distribution contract)

## Purpose

Provide versioned, explainable plant reference data for offline applications. It is reusable independently of Hortinis and excludes personal garden data.

## Initial product scope

The first profile covers common vegetables and herbs grown outdoors or in unheated shelters in metropolitan France. It supports cold-risk and sowing/planting-window recommendations for crops already selected by the gardener.

It does not promise complete cultivar coverage, live weather, disease diagnosis, crop discovery, companion planting, rotations, images or medicinal advice.

## Ownership boundary

The catalog owns plant identity, cultivation parameters, applicability, evidence, provenance, licence and confidence. Hortinis owns garden state, observations, weather, recommendation rules, scoring, explanations, lifecycle and overrides.

## Profiles

- `fr-mvp`: the reviewed MVP plant set and required rules;
- `fr-rich`: broader France coverage and additional reviewed relationships;
- `global-core`: global taxonomy and generally reusable traits;
- optional regional or image packs, each with its own licence manifest.
