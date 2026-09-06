# Hortinis Plants

Hortinis Plants is the versioned plant reference catalog for Hortinis and other applications.

It contains source adapters, evidence, reviewed records, schemas, validation rules and release tooling. It does not contain personal garden data, live weather or recommendation state.

Repository data is compiled by GitHub Actions into immutable, gzip-compressed JSON Lines artifacts. Hortinis verifies and stores a local snapshot in IndexedDB.

## Scope

The first release covers 33 selected vegetables and herbs in metropolitan France, including Corsica, for:

- cold-risk context for existing crops;
- sowing and planting windows for selected crops.

The catalog provides plant facts, cultivation parameters, applicability, evidence, licences and confidence. Hortinis owns weather, evaluation, scoring, explanations and recommendation lifecycle.

The MVP includes French and English localized-name handling and two tomato cultivar exemplars while keeping generic plant concepts independently selectable. Images and static climate-cell data are separate future artifacts.

See [the catalog charter](docs/product/catalog-charter.md), [the source register](docs/sources/source-register.md), and [the implementation plan](docs/development/implementation-plan.md).

## Repository language

Repository-authored content is written in English. Localized plant names and gardener-facing values may contain French and other languages.

## Licence

Pipeline code is licensed under [AGPL-3.0-only](LICENSE). Original Hortinis-authored assertions are licensed under CC BY 4.0. Imported assertions retain their source-specific rights as described in [the data licence policy](DATA-LICENSE.md).
