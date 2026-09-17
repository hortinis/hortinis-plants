# Qualified source keys

Every upstream record identity is scoped by its source release. The canonical V1 representation is nested:

```json
{
  "source": {
    "sourceId": "source_grow",
    "sourceManifestId": "source_manifest_grow_2020",
    "sourceReleaseId": "grow-2020"
  },
  "recordId": "1"
}
```

`sourceRecordKey` values are used for source records and source-backed decisions. A source-location key has the
same nested `source` release key and a semantic `locationId`; locations are release-scoped because one location
may apply to many source records. A semantic subrecord key adds an ordered path of typed semantic parts such as a
source field, cultivation window or nested claim.

Keys are serialized canonically for map lookups and generated identifiers. Array positions and file paths are never
key components. Equal local IDs from different sources therefore coexist, while duplicate complete keys are
rejected by coverage and dataset validation.
