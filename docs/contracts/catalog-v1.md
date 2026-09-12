# Catalog V1 consumer contracts

- Status: validated

V1 defines the language-neutral consumer records required by the local-validation artifact. The schemas
are authoritative in this repository and use stable identifiers under
`urn:hortinis:plants:schema:v1:`. Consumers pin copies of the complete schema set and validate data
without importing catalog implementation code.

## Contract set

The artifact contracts are `release-manifest` and `artifact-descriptor`. The minimum identity and
cultivation contracts are `taxon`, `plant-concept`, `localized-name`, `cultivation-context` and
`cultivation-rule`. The shared provenance records are `evidence-reference`, `source`, `licence`,
`review` and `attribution`. `common` contains reusable schema definitions and is not an artifact entry
type.

Each public schema describes one JSON object. JSON Lines chunks contain one object per line and declare
the object's schema identifier in their artifact descriptor. Metadata is normalized: catalog records
refer to evidence records by identifier, and evidence records refer to shared source, licence and review
records. A source, licence or review is not repeated in every plant or rule.

## Versions and artifact descriptors

The manifest uses semantic versions for the schema, catalog and minimum consumer versions. A V1 schema
accepts schema versions with major version `1` and rejects other major versions. JSON Schema verifies
the version syntax and supported schema major; comparing the minimum consumer version with a running
application is a consumer compatibility check.

Artifact paths are safe relative paths. An artifact descriptor records its kind, media type, schema
identifier, byte size and lowercase SHA-256 digest. A `jsonl-gzip` descriptor additionally requires
`contentEncoding: gzip` and a non-negative entry count. The manifest does not describe itself because a
self-checksum would be recursive.

The manifest separates required and optional artifacts. Missing required artifacts prevent activation;
missing optional artifacts do not. Duplicate paths, hash and size verification, entry counts and
reference resolution are artifact-level checks implemented in V1.3 and by Hortinis, not cross-document
capabilities of JSON Schema.

## Identity, retirement and localization

Taxa provide scientific identity. Plant concepts provide stable gardener-facing identity and reference
a taxon without using its name as an identifier. Both record types can be active or retired and may
identify a replacement. Artifact-level validation must ensure referenced and replacement identifiers
resolve and do not form invalid cycles.

Only catalog-owned user-facing text is localized. Each localized name is a separate, BCP 47-tagged
record associated with a taxon or plant concept. Rules, identifiers, contexts, units and review states
remain structured language-neutral values. A profile may omit a requested language; consumers fall back
to another explicitly tagged preferred name and then to the scientific name. Preferred-name uniqueness,
tag canonicalization and fallback ordering require semantic checks across records.

Public consumer records allow additive top-level properties so an older V1 consumer can ignore a
compatible addition. Closed nested structures such as checksums, normalization metadata, rights
decisions and timing variants reject unknown properties because an unknown member could change their
meaning.

## Cultivation rules

V1 rules publish plant-specific parameters, not recommendations. A rule references a plant concept or
cultivar, a reusable cultivation context and evidence. Cultivar-scoped rules remain cultivar-scoped and are
never widened to the parent plant concept. The minimum timing variants are a calendar-date window and a
day-offset window relative to the last spring frost, first autumn frost or previous crop harvest.

The catalog does not translate rule actions into prose or combine them with the current date, garden,
weather or observations. Hortinis evaluates applicable rules and owns explanations, limitations and
abstention. Soil-temperature, growing-degree-day and richer cultivar-specific rule contracts remain
outside V1.1 unless the accepted P0.7a scenario proves one is required.

## Provenance and rights

Evidence references preserve the source manifest, source release, source record and locator. When a
value is normalized, the evidence reference stores the original JSON value and may describe the
normalization method. Its rights decision references a licence and records an explicit eligibility
decision and reason. Its review identifier resolves to a separate review record.

Licence records describe the rights instrument and required notice. Attribution records connect an
included record scope to a source release, licence, profile and notice. Their inclusion keeps
`attributions.json` machine-validatable without treating a licence declaration as proof of rights in
upstream material.

V1.1 schemas describe compiled consumer projections. They do not define the generic assertion authoring
contract used before projection. V1.2 defines that boundary with the assertion, cultivar and curation-issue
schemas. The tracked `dev-validation` input contains generic tomato, two explicitly scoped tomato cultivars
(`Marmande` and `Montfavet H 63-5 F1`) and lettuce. This authoring dataset is compiled into consumer records
in V1.3; it is not itself a release artifact.
