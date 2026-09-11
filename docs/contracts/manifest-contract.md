# Manifest contract

The manifest is the acquisition entry point. It contains catalog and schema versions, generation timestamp, minimum consumer version, profile and separate lists of required and optional artifacts.

Each listed artifact has a safe relative path, kind, schema identifier, byte size, SHA-256 digest and media type. A compressed JSON Lines chunk also has a gzip content encoding and entry count. Source, licence, attribution and versioned schema files are themselves listed artifacts. The manifest does not list itself because hashing it would be recursive.

Schema, catalog and minimum-consumer versions use semantic-version strings. The V1 manifest schema accepts compatible `1.x` schema versions and rejects another schema major. The consumer separately compares the declared minimum consumer version with its own version.

Trust the manifest only when acquired through the operator-selected local import or authenticated HTTPS channel, as required by ADR-0014. Hashes provide integrity relative to that trusted source.

The initial contract has no signature or key-distribution field. Add signing only through a compatible contract revision backed by a defined threat model, trust root and rotation procedure.
