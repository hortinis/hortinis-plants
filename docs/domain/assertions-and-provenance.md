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

Quality states are `unreviewed`, `accepted`, `rejected` and `superseded`. A conflict is preserved until a review decision resolves it; it is never silently overwritten.

The projection compiler may include only accepted assertions whose licence decision permits the selected release profile.
