# Assertions and provenance

An authored assertion is one claim about one subject in one context. It has a stable ID, fixed predicate,
explicit value, context ID, evidence-reference IDs and a content-review ID. Assertions belong to
`schemas/authoring/v1`; they are curation inputs, not the consumer projection schema.

Each evidence reference preserves its source ID, pinned source-manifest ID, source release, source record,
locator, rights decision, licence reference and separate rights-review reference. If a value was normalized,
the original source value and normalization method are retained. The authored assertion's review ID points
to a content review. Rights review and content review must not be conflated.

```json
{
  "id": "assertion_tomato_frost",
  "subject": { "type": "plant-concept", "id": "plant_tomato" },
  "predicate": "frost_sensitivity",
  "value": "sensitive",
  "contextId": "context_fr_outdoor",
  "evidenceReferenceIds": ["evidence_tomato_rule"],
  "reviewId": "review_tomato"
}
```

The authoring dataset may retain open, unreviewed, rejected or contradictory claims and explicit curation
issues. A consumer release includes only accepted records with evidence and a rights decision eligible for
the selected profile. A source's file-level licence is not, by itself, proof of rights in upstream material.

The V1.2 tomato, Marmande, Montfavet and lettuce records are synthetic scenario fixtures. Their accepted
review state validates the workflow shape only; it is not a production content or rights determination.
Unknown values remain absent or explicitly unknown. Importers and projection tooling must not infer a value,
context, scope, translation or source interpretation.
