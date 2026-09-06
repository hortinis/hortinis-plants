# Catalog model

## Core concepts

`Taxon` is botanical identity from an accepted backbone. `PlantConcept` is the gardener-facing cultivated subject. `CultivarGroup` and `Cultivar` are optional children. `Name` is a localized or scientific label. A plant concept may reference a taxon, but the taxon is not the product identifier.

An `Assertion` is one sourced claim about one subject in one context. A reviewed `Projection` is a compact application value compiled from accepted assertions.

## Required entities

- `taxon`
- `plant_concept`
- `cultivar_group`
- `cultivar`
- `name`
- `source`
- `source_release`
- `license`
- `citation`
- `assertion`
- `cultivation_rule`
- `relationship`
- `threat`
- `geographic_context`
- `review_decision`

## Identifier rules

Identifiers are stable, opaque strings minted by the catalog. Scientific names, aliases, paths and array positions are not identifiers. Retired records remain resolvable and point to a replacement when one exists.

User records may retain a free-form historical label when no catalog entry exists. Linking a catalog identifier later must not rewrite that label.

## Cultivar and name rules

A generic plant concept remains selectable without a cultivar. A user record may optionally reference a catalog cultivar or retain a free-form cultivar label under the generic concept.

Assertions declare plant-concept, cultivar-group or cultivar scope. Compilers must not widen a narrower assertion. A missing cultivar produces generic facts only, plus an explicit limitation or abstention when a required fact is cultivar-dependent.

Localized names carry BCP 47 language tags. The MVP exercises French and English and falls back deterministically to another tagged name and then to the scientific name. Fallback does not change or hide the stored language tag.

## Runtime boundary

The catalog excludes garden plantings, user observations, forecasts, tasks, recommendations and synchronization operations.
