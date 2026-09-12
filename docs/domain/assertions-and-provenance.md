# Assertions and provenance

Every factual value is represented as an assertion before it becomes a released projection.

```json
{
  "id": "assertion_01",
  "subjectId": "plant_tomato",
  "predicate": "transplant_window",
  "value": { "startOffsetDays": 7, "endOffsetDays": 21 },
  "context": {
    "geography": "europe-atlantic",
    "growingSystem": "outdoor",
    "propagation": "transplant"
  },
  "provenance": {
    "sourceReleaseId": "grow-epd-2020",
    "sourceRecordId": "tomato",
    "sourceLocator": "PlantingCalendar.xlsx!Tomato"
  },
  "rights": { "license": "CC-BY-4.0", "commercialUse": "allowed" },
  "quality": { "status": "accepted", "confidence": 0.84 }
}
```

Assertions retain source-specific values and contexts. Normalization may convert units and controlled terms, but it must retain the original value and locator.

The V1.2 validation dataset authors assertions separately from consumer projections. An assertion subject may
be a plant concept, cultivar group or cultivar. Cultivar-scoped assertions retain the cultivar identifier and
must not be widened to the parent plant concept during projection. The validation subset includes generic
tomato, `Marmande`, `Montfavet H 63-5 F1` and lettuce; their values are scenario fixtures and require the same
source and rights review as any future release assertion.

Quality states are `unreviewed`, `accepted`, `rejected` and `superseded`. A conflict is preserved until a review decision resolves it; it is never silently overwritten.

The projection compiler may include only accepted assertions whose licence decision permits the selected release profile.
