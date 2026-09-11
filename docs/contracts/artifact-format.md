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

The artifact contract is independent of acquisition transport. An operator-selected local file set and an
authenticated HTTPS source expose the same manifest-referenced bytes to the consumer's compatibility,
integrity and schema-validation pipeline. A ZIP or other aggregate container is not part of the initial
contract.

The `dev-validation` profile may use a flat artifact directory to support explicit browser file selection.
It follows this complete artifact contract but is not a publishable release profile.

Compressed chunks target approximately 1 MiB and must not exceed 2 MiB. The first release is unsigned: authenticity relies on explicit operator selection or authenticated HTTPS, and manifest hashes provide integrity relative to that trusted source.
