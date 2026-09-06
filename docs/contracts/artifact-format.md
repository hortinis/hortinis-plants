# Artifact format

This contract follows Hortinis ADR-0014.

Each immutable release contains `manifest.json`, a versioned JSON Schema, deterministic size-bounded gzip JSONL chunks, SHA-256 hashes and attribution/licence manifests.

The manifest includes:

- schema version;
- catalog version;
- generation timestamp;
- minimum consumer version;
- required and optional chunks;
- compressed byte size;
- entry count;
- SHA-256 digest;
- source and licence manifest references.

Entries use stable opaque identifiers and retain source-release references. Additive fields are compatible when unknown fields can be ignored. Breaking changes require a schema-major version and explicit consumer approval.

Builds must be deterministic: stable ordering, normalized newlines, fixed serialization and reproducible gzip output.
