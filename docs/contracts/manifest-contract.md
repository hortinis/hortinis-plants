# Manifest contract

The release manifest is the consumer's acquisition entry point. It declares schema and catalog
versions, minimum consumer version, profile, generation timestamp, and separate required and optional
artifact lists.

Each artifact has a safe relative path, byte size and SHA-256 digest. A metadata artifact descriptor
identifies a JSON document or schema. A chunk descriptor additionally identifies its single record
schema, JSON Lines media type, gzip encoding and entry count. A JSONL chunk must not mix record schemas.
The manifest does not list itself because its self-checksum would be recursive.

Consumers first acquire the manifest from an operator-selected local import or authenticated HTTPS
channel, as specified by ADR-0014, then verify all referenced bytes before activation. Hashes establish
integrity relative to that trusted manifest; they do not establish authenticity. Required-artifact
presence, optional-artifact handling, digest/size/count checks and record/reference validation are
semantic consumer checks in addition to JSON Schema validation.

Schema identifiers and schema version values identify the V1 contract. The release also carries a
minimum consumer version, but version comparison and compatibility policy are deferred for coordination
with Hortinis. The manifest schema does not contain a compatibility table or migration declaration.

The initial contract has no signature or key-distribution field. Add signing only through a contract
revision backed by an agreed threat model, trust root and rotation procedure.
