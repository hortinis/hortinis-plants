# Catalog implementation plan

- Status: planned
- Tracking states: `planned`, `in progress`, `validated`, `blocked`

## Work packages

- **C0 — Decisions:** choose code/data licences, the metropolitan-France MVP and cultivar depth; confirm ownership boundaries, opaque ID lifecycle and horticultural-review authority.
- **C1 — Foundation:** add schemas, source manifests, importer boundaries, contributor workflow, deterministic build rules and CI checks.
- **C2 — Contracts:** implement taxon, plant concept, cultivar, name, source, assertion, context, licence, review, cultivation-rule, relationship, manifest, chunk and compatibility schemas; add conformance fixtures.
- **C3 — Sources:** pin WFO, TAXREF and GROW; preserve GROW image exclusions; retain Practical Plants block licences; audit CropGraph citations and geography; implement immutable-locator adapters.
- **C4 — Curation:** reconcile identities; separate plant concepts from taxa; normalize names, units, contexts and calendar anchors; report unresolved mappings and contradictions; curate the MVP.
- **C5 — Release:** compile accepted projections into deterministic JSONL.gz chunks; generate manifests, hashes, source manifests and attribution; enforce size, determinism and licence gates; publish manual GitHub Release assets.
- **C6 — Integration:** test contract acquisition, Dexie import, activation, rollback, quota failure, retired references and cross-runtime recommendation fixtures.

Catalog integration in Hortinis remains blocked until its foundation readiness gate and P0.7 catalog/recommendation specification are accepted.
