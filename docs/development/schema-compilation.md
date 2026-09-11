# Schema compilation

C1.5 compiles every tracked `*.schema.json` document under `schemas/` with Ajv's JSON Schema
2020-12 implementation during the build. Each schema must declare a non-empty absolute `$id`; the
identifier is the registry key and is independent of the source filename.

The compiler sorts schemas by identifier, rejects duplicate identifiers, registers all schemas before
compiling them, and forces every registered schema to compile so unresolved references fail the build.
Ajv mutation options are disabled: compilation does not coerce values, apply defaults or remove fields.

The build emits a CommonJS standalone validator registry at `dist/generated/schema-registry.cjs`.
`dist/` is generated and ignored by Git. The registry exposes `validatorsBySchemaId` for the C1.6
validation API; consumers should not configure Ajv directly. The current example schema exists only to
prove the compilation boundary. Domain schemas belong to V1.1.
