# Hortinis Plants

Hortinis Plants is the versioned plant reference catalog for Hortinis and other applications.

It contains source adapters, evidence, reviewed records, schemas, validation rules and release tooling. It does not contain personal garden data, live weather or recommendation state.

Repository data is compiled by GitHub Actions into immutable, gzip-compressed JSON Lines artifacts. Hortinis verifies and stores a local snapshot in IndexedDB.

## Scope

The first release covers common vegetables and herbs in metropolitan France for:

- cold-risk context for existing crops;
- sowing and planting windows for selected crops.

The catalog provides plant facts, cultivation parameters, applicability, evidence, licences and confidence. Hortinis owns weather, evaluation, scoring, explanations and recommendation lifecycle.

See [the catalog charter](docs/product/catalog-charter.md), [the source register](docs/sources/source-register.md), and [the implementation plan](docs/development/implementation-plan.md).

## Repository language

Repository-authored content is written in English. Localized plant names and gardener-facing values may contain French and other languages.
