# Catalog architecture

The catalog is file-based and build-time. It has no runtime database or mandatory service.

```text
source releases
    -> source adapters
    -> normalized assertions
    -> review and projections
    -> licence and quality gates
    -> deterministic JSONL.gz artifacts
    -> GitHub Release or operator-selected local artifact
    -> Hortinis IndexedDB snapshot
```

Use Node.js 24, TypeScript, pnpm, JSON Schema 2020-12, Ajv and Vitest. Stream large archives, including Practical Plants. Git is canonical editorial history; GitHub Actions validates and compiles releases. Generated artifacts are release assets, not source files.

The catalog never owns personal garden data. A Hortinis sync server may host artifacts, but catalog installation remains separate from garden synchronization.
