# Test fixtures

Store reusable, reviewable fixture data here. Keep fixture files small and
deterministic; identify the source or contract they exercise in the filename
or an adjacent README.

Schema conformance fixtures are grouped by contract version under
`schema-conformance/`. Each version directory contains a `manifest.json` and
raw JSON documents. The manifest records the schema identifier, fixture case
identifier and expected result. Invalid cases assert stable error keywords and
instance paths; they do not assert Ajv-specific messages. A case may instead
assert a validation pipeline error such as `UNKNOWN_SCHEMA_ID`.

Generated validator registries and release artifacts are temporary test/build
outputs and must remain outside ordinary Git history.
