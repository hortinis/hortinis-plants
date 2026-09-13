# Catalog V1 consumer contracts

- Status: validated

Catalog V1 is the language-neutral contract for plant identity and cultivation data exchanged with
Hortinis. JSON Schemas under `schemas/catalog/v1/` define consumer records; schemas under
`schemas/authoring/v1/` define curation inputs that are not themselves release records. Consumers can
pin and validate the JSON Schemas without importing this repository's implementation code.

## Record families

The catalog is a set of linked records, not one deeply nested object per plant:

- Identity: `taxon`, `plant-concept`, `cultivar-group`, `cultivar`, and `localized-name`.
- Facts and applicability: `plant-fact`, `cultivation-context`, `cultivation-rule`,
  `geographic-context`, and `relationship`.
- Provenance and governance: `evidence-reference`, `source`, `licence`, `review`, and `attribution`.
- Delivery: `release-manifest`, metadata `artifact-descriptor`, and `chunk-descriptor`.

Every JSON Lines chunk contains records of exactly one schema, identified by `schemaId` in its chunk
descriptor. The consumer follows stable identifiers to join records. It does not need to understand
authoring assertions or the curation issue queue to read a release.

## Example: a tomato and a cultivar

The following records are an illustrative view of the current `dev-validation` scenario, not verified
horticultural advice or a production rights determination. The actual records are split across schema-
homogeneous chunks. Values are included only because the fixture explicitly supplies them; missing facts
stay missing.

An output therefore looks like several schema-homogeneous streams. These sample records are taken from
the validation fixture; each block shows records of one schema:

Plant concept and botanical identity:

```json
{
  "id": "plant_tomato",
  "status": "active",
  "taxonId": "taxon_tomato",
  "evidenceReferenceIds": ["evidence_tomato_identity"]
}
```

```json
{
  "id": "taxon_tomato",
  "status": "active",
  "scientificName": "Solanum lycopersicum",
  "evidenceReferenceIds": ["evidence_tomato_identity"]
}
```

Localized name and generic plant fact:

```json
{
  "id": "name_tomato_fr",
  "subject": { "type": "plant-concept", "id": "plant_tomato" },
  "languageTag": "fr",
  "value": "tomate",
  "kind": "common",
  "preferred": true,
  "evidenceReferenceIds": ["evidence_tomato_name"]
}
```

```json
{
  "id": "fact_tomato_frost",
  "status": "active",
  "subject": { "type": "plant-concept", "id": "plant_tomato" },
  "predicate": "frost_sensitivity",
  "value": "sensitive",
  "contextId": "context_fr_outdoor",
  "evidenceReferenceIds": ["evidence_tomato_rule"],
  "reviewId": "review_tomato"
}
```

Cultivar identity and its own cultivation rule:

```json
{
  "id": "cultivar_marmande",
  "status": "active",
  "plantConceptId": "plant_tomato",
  "denomination": "Marmande",
  "evidenceReferenceIds": ["evidence_marmande"]
}
```

```json
{"id":"rule_tomato_generic","status":"active","subject":{"type":"plant-concept","id":"plant_tomato"},"contextId":"context_fr_outdoor","action":"transplant","timing":{"type":"relative-day-window","anchor":"last_spring_frost","startOffsetDays":14,"endOffsetDays":42},"evidenceReferenceIds":["evidence_tomato_rule"],"reviewId":"review_tomato"}
{"id":"rule_marmande","status":"active","subject":{"type":"cultivar","id":"cultivar_marmande"},"contextId":"context_fr_outdoor","action":"transplant","timing":{"type":"relative-day-window","anchor":"last_spring_frost","startOffsetDays":21,"endOffsetDays":49},"supersedesRuleIds":["rule_tomato_generic"],"evidenceReferenceIds":["evidence_marmande_rule"],"reviewId":"review_marmande"}
```

The rule block is one JSONL chunk because both records share the cultivation-rule schema. `evidenceReferenceIds`
lead to records carrying source release, source record, locator, rights decision and rights-review
reference. `reviewId` identifies the content review for a fact or rule.

For example, the cultivar rule's evidence and its two review decisions are linked records too:

```json
{
  "id": "evidence_marmande_rule",
  "sourceId": "source_validation_fixture",
  "sourceManifestId": "source_manifest_dev_validation",
  "sourceReleaseId": "dev-validation-1",
  "sourceRecordId": "marmande-rule",
  "locator": "fixture://tomato/marmande/rule",
  "rights": {
    "licenceId": "licence_cc_by_4_0",
    "decision": "eligible",
    "reason": "Curated validation fixture",
    "reviewId": "review_rights_fixture"
  }
}
```

```json
{"id":"review_marmande","purpose":"content","status":"accepted","reviewedAt":"2026-09-11T00:00:00Z","reviewerId":"hortinis-maintainer","confidence":0.8,"notes":"Scenario fixture; cultivar-specific scope retained."}
{"id":"review_rights_fixture","purpose":"rights","status":"accepted","reviewedAt":"2026-09-11T00:00:00Z","reviewerId":"hortinis-maintainer","notes":"Synthetic dev-validation provenance only; not a production source-rights determination."}
```

Hortinis can load the manifest, verify the compressed chunk hashes/counts, validate each line with the
declared schema, then resolve IDs to compose a selected plant and cultivar view. The content review and
rights review remain distinguishable, and this synthetic fixture is not evidence that the data can ship in
a production profile.

For a selected cultivar, Hortinis starts with the parent plant-concept data and applies cultivar-scoped
data automatically. A cultivar record replaces a parent record only when its `supersedes*Ids` explicitly
names that parent record. Otherwise both records remain available; the catalog does not guess which value
is more specific, average them, or silently discard one. A generic tomato selection receives generic data
only. This inheritance behavior is a consumer projection rule; it does not change the stored scope of a
cultivar record.

## Identity and names

Taxa carry botanical identity; plant concepts carry Hortinis-facing identity. A concept may omit `taxonId`
when the mapping is not known. Taxon, concept, group and cultivar IDs are stable opaque strings, never
scientific names, file paths or row numbers. Cultivars require a denomination and parent plant concept;
group membership is optional and may include zero or multiple group IDs.

Localized names belong to a subject and carry a BCP 47 language tag. A cultivar's denomination is not
treated as a translation. Consumers may choose an explicitly available name but must not synthesize a
translation or infer an absent name.

## Facts, contexts and rules

`plant-fact` uses the fixed predicate registry and typed value branches. `cultivation-rule` carries one of
the fixed actions and one timing form: calendar-month window, calendar-date window, relative-day window,
soil-temperature threshold, or growing-degree-day threshold. Calendar months/dates are not conflated;
cross-year windows are represented by start and end values in order. Relative anchors are explicit.
Temperature uses `Cel`; GDD uses `Cel.d`, a stated base temperature and `daily-mean` method.

Every claim refers to a context. Geographic scope is either a set of stable geographic-context IDs or
explicitly `unknown`. Geographic contexts describe semantic scope and parentage only: these contracts do
not ship polygons, coordinates, climate grids or dynamic weather. Missing data is not inferred.

Rules publish parameters, not final recommendations. Hortinis combines applicable catalog records with
garden state and observations, owns any explanation, and may abstain when required input is missing.

## Authoring versus consumer release

`authoring:v1:assertion` records one source-backed statement before projection; `authoring:v1:curation-issue`
records unresolved mappings, contradictions and review issues. Authoring can retain unreviewed or rejected
material and is not a consumer release. Consumer chunks contain only accepted records whose evidence,
rights review and licence permit the selected release profile. Content review and rights review have
separate purposes; a file-level licence declaration is not proof of upstream rights.

## Delivery and versions

The release manifest separates required and optional artifacts and records schema version, catalog
version, minimum consumer version, profile and generation time. A JSON Lines chunk descriptor includes
its single record schema, gzip encoding, byte size, entry count and SHA-256 digest. Metadata artifact
descriptors describe manifests or schema documents. Manifest self-checksums are avoided because they
would be recursive.

Schema identifiers carry the contract major (`...:v1:`); the schema version field validates as `1.x`.
Version comparison, compatibility guarantees, migration policy and compatibility fixtures are deferred
until coordinated with Hortinis. This contract does not define a compatibility table or runtime policy.

JSON Schema validates individual record shape. Cross-record referential integrity, duplicate detection,
supersession ancestry, profile eligibility, rights gates and chunk integrity require build-time or
consumer-level semantic checks.
