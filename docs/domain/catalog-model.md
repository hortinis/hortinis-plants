# Catalog model

## Core concepts

`Taxon` is botanical identity from an accepted backbone. `PlantConcept` is the gardener-facing cultivated subject. `Cultivar` is optional. `Name` is a localized or scientific label. A plant concept may reference a taxon, but the taxon is not the product identifier.

An `Assertion` is one sourced claim about one subject in one context. A reviewed `Projection` is a compact application value compiled from accepted assertions.

## Required entities

- `taxon`
- `plant_concept`
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

## Runtime boundary

The catalog excludes garden plantings, user observations, forecasts, tasks, recommendations and synchronization operations.
