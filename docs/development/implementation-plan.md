# Catalog implementation plan

- Status: planned
- Tracking states: `planned`, `in progress`, `validated`, `blocked`

## Work packages

- **C0 — Decisions (`validated`):** code/data licences, ShareAlike treatment, the metropolitan-France MVP, cultivar depth, schema ownership, release coordination and sole-maintainer review authority are accepted in ADR-0004 through ADR-0006.
- **C1 — Foundation:** add schemas, source manifests, importer boundaries, contributor workflow, deterministic build rules and CI checks.
- **C2 — Contracts:** implement taxon, plant concept, cultivar group, cultivar, localized name, source, assertion, context, licence, review, cultivation-rule, relationship, manifest, chunk and compatibility schemas; add conformance fixtures.
- **C3 — Sources:** pin WFO, TAXREF and GROW; preserve GROW image exclusions; retain Practical Plants block licences; audit CropGraph citations and geography; implement immutable-locator adapters.
- **C4 — Curation:** reconcile identities; separate plant concepts from taxa; normalize names, units, contexts and calendar anchors; report unresolved mappings and contradictions; curate the MVP.
- **C5 — Release:** compile accepted projections into deterministic JSONL.gz chunks; generate manifests, hashes, source manifests and attribution; enforce size, determinism and licence gates; publish manual GitHub Release assets.
- **C6 — Integration:** test contract acquisition, Dexie import, activation, rollback, quota failure, retired references and cross-runtime recommendation fixtures.
- **C7 — Optional artifacts (`planned`):** after the first release, specify and build independently licensed image packs with per-image provenance; coordinate a separate `hortinis-climate` repository and artifact without making either one a core catalog dependency.

Production catalog integration in Hortinis remains blocked until its foundation readiness gate and P0.7
catalog/recommendation specification are accepted. A separate local-validation track may proceed earlier
under the constraints described in `V1` below; it does not qualify as a catalog release or foundation
readiness.

## C1 technical execution plan

Each step is intended to be implemented and validated independently. Every completed step must leave all previously introduced checks passing.

### C1.1 — Project bootstrap

- Pin Node.js 24 and pnpm.
- Create an ESM `package.json` and commit the pnpm lockfile.
- Add strict TypeScript configuration.
- Create minimal source and test directories.
- Add build and type-check commands.

Acceptance: a clean checkout can install dependencies, type-check and build.

### C1.2 — Linting and formatting

- Add ESLint with flat configuration and TypeScript support.
- Add deterministic formatting checks.
- Ignore downloaded inputs and generated release artifacts.
- Provide check and automatic-fix commands.

Acceptance: lint and formatting checks pass without changing files.

### C1.3 — Testing foundation

- Configure Vitest for TypeScript on Node.js.
- Add test and coverage commands.
- Establish unit-test and fixture locations.
- Add a minimal smoke test for the test harness.

Acceptance: tests and coverage run successfully from a clean checkout.

### C1.4 — Basic continuous integration

- Run CI with Node.js 24 and the pinned pnpm version.
- Install dependencies using the frozen lockfile.
- Run formatting, linting, type-checking, build and tests.
- Cache pnpm dependencies without caching generated catalog artifacts.
- Do not download catalog sources or publish releases in basic CI.

Acceptance: pushes and pull requests run the same checks available locally.

### C1.5 — Schema compilation infrastructure

- Add Ajv with JSON Schema 2020-12 support.
- Define locations for authored schemas and generated compilation output.
- Register schemas by stable schema identifier.
- Detect duplicate identifiers and unresolved references.
- Compile schemas during the build while keeping generated output out of ordinary Git history.

Acceptance: an example schema can be compiled and loaded by its identifier.

### C1.6 — Validation API

Create a small repository-owned API between callers and Ajv. Callers provide a schema identifier and an unknown value. Ordinary data failures return a structured result instead of throwing:

```ts
type ValidationResult =
  | { valid: true }
  | { valid: false; errors: ValidationError[] };

interface ValidationError {
  instancePath: string;
  schemaPath: string;
  keyword: string;
  message: string;
}
```

- Compile validators once and reuse them.
- Return stable error ordering for deterministic reports.
- Do not expose Ajv-specific objects outside the validation module.
- Do not apply defaults, remove fields or otherwise transform input during validation.
- Treat an unknown schema identifier or invalid registry configuration as a pipeline error.

Acceptance: consumers can validate data without importing or configuring Ajv directly.

### C1.7 — Schema conformance testing

- Require positive and negative fixtures for schemas.
- Verify expected failure keywords and instance paths.
- Verify that unknown schema identifiers fail closed.
- Verify that references between schemas resolve.
- Verify deterministic schema compilation.

Acceptance: the example schemas and validation API have complete passing and failing fixture coverage.

### C1.8 — Canonical JSON

- Serialize object keys in a stable order while preserving array order.
- Reject unsupported values, including `undefined`, functions and non-finite numbers.
- Emit UTF-8 with normalized newlines.
- Define duplicate-key behavior when parsing raw JSON.

Acceptance: logically identical objects produce identical bytes and SHA-256 hashes.

### C1.9 — Streaming JSON Lines

- Read and write one canonical JSON value per line.
- Process records without loading a complete dataset into memory.
- Include line numbers in parsing and validation errors.
- Define blank-line and final-newline behavior.
- Allow validation during streaming reads and writes.

Acceptance: a large generated fixture is processed with bounded memory and deterministic output.

### C1.10 — Hashing and deterministic gzip

- Calculate SHA-256 while streaming.
- Fix gzip settings and remove variable gzip metadata.
- Record compressed byte size and entry count.
- Test byte-for-byte reproducibility.

Acceptance: two runs over identical inputs produce identical compressed bytes, sizes and hashes.

### C1.11 — Source-manifest boundary

Define the technical contract for describing one pinned upstream release. A source manifest identifies exactly what was acquired and records its provider, release identifier, locator, checksum, licence review state and profile eligibility. It does not contain normalized plant assertions.

Acceptance: source manifests can be validated and referenced by stable identifiers without implementing a real source adapter.

### C1.12 — Importer boundary and run manifest

Define the interface for deterministic importers without implementing source-specific transformations. An importer converts a pinned source release into normalized assertions while preserving original record identifiers, locators, values, rights and unresolved mappings.

An importer run manifest records:

- importer name and version;
- input source-manifest identifier and checksum;
- relevant configuration;
- output checksums and record counts;
- warnings, rejected records and unresolved mappings;
- tool versions required for reproducibility.

The source manifest describes the input. The importer run manifest describes one transformation of that input.

Acceptance: a fixture importer can run through the boundary and produce a validated, deterministic run manifest.

## Local-validation track

The local-validation track is a deliberately smaller path for validating the Hortinis domain and product
behavior before the complete catalog foundation and the Hortinis foundation readiness gate are complete.
It produces a real ADR-0014-shaped artifact, but not a publishable `fr-mvp` release.

### V1 — Local validation artifact (`planned`)

V1 requires only the following C1 capabilities:

- C1.5 schema compilation;
- C1.6 validation API;
- critical positive and negative C1.7 fixtures;
- C1.8 canonical JSON;
- the essential C1.10 gzip, SHA-256, byte-size and entry-count behavior; and
- a minimal C1.11 source-manifest contract.

The artifact builder may use a small curated input set and may process it in memory. It must emit a
consumer-facing local release directory containing `manifest.json`, versioned schemas, JSONL.gz chunks,
source metadata and licence/attribution metadata. Every assertion still retains its source release,
record identifier, locator, original value where relevant, rights decision and review state.

The following remain outside the V1 gate and are required later for a production release:

- C1.4 continuous integration;
- complete C1.7 conformance coverage;
- C1.9 bounded-memory streaming;
- the generic C1.12 importer and run-manifest abstraction;
- source download and large-archive adapters;
- multi-source reconciliation and full curation; and
- release publication and production release gates.

V1 output is labelled `dev-validation`, stays out of ordinary Git history, and must not be represented as
the first `fr-mvp` release.

## Catalog-specific sequence

Production catalog-specific implementation begins after the generic C1 primitives and boundaries are
validated. The V1 local-validation track may begin after its reduced gate above.

1. **C2 — Domain contracts:** define the taxon, plant concept, cultivar group, cultivar, localized name, source, assertion, context, licence, review, cultivation-rule, relationship, release-manifest, chunk and compatibility schemas with conformance fixtures.
2. **C3 — Concrete sources:** create pinned source manifests and source-specific importers for WFO, TAXREF, GROW and later approved sources.
3. **C4 — Curation:** reconcile identities, normalize values and contexts, review rights, and report contradictions and unresolved mappings.
4. **C5 — Release construction and publishing:** compile accepted data into deterministic JSONL.gz chunks, produce release, source, licence and attribution manifests, run build and licence gates, compare two builds, and publish immutable GitHub Release assets.

The release manifest is the consumer-facing acquisition entry point. It records catalog and schema versions, profile, minimum consumer version, required and optional chunks, counts, sizes, hashes and references to source, licence and attribution manifests. Its schema belongs to C2; producing and publishing populated release manifests belongs to C5. Publishing is deliberately excluded from basic CI.
