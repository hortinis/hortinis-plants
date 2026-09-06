# Manifest contract

The manifest is the acquisition entry point. It contains catalog and schema versions, generation timestamp, minimum consumer version, profile and every required or optional chunk.

Each chunk has a stable name, compressed byte size, entry count, SHA-256 digest and media type. Source, licence and attribution manifests are themselves listed artifacts.

Trust the manifest only when acquired through the operator-selected local import or authenticated HTTPS channel, as required by ADR-0014. Hashes provide integrity relative to that trusted source.
