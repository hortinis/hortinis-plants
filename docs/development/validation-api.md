# Validation API

C1.6 exposes the repository-owned validation boundary used by catalog tooling. Callers provide a
schema identifier and an unknown value; they do not import or configure Ajv.

`validate` returns `{ valid: true }` for valid data. Ordinary schema failures return `{ valid: false,
errors }`, where each error contains only `instancePath`, `schemaPath`, `keyword` and `message`.
Errors are sorted deterministically by those fields in that order.

Unknown schema identifiers, an unavailable or malformed generated registry, malformed validator
results, and validator execution failures throw `ValidationPipelineError`. These are pipeline failures,
not data-validation results.

The generated standalone registry is loaded lazily and cached. Validation does not coerce values, apply
defaults, remove fields or otherwise transform input.
