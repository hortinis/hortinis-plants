# ADR-0001: File-based canonical repository

- Status: validated

## Decision

Git-tracked source manifests, normalized assertions and reviewed records are canonical. GitHub Actions compiles releases. The repository requires no database or runtime service.

## Consequences

Changes are reviewable and reproducible. Store large raw archives and generated artifacts in release assets or external archival storage, not Git history. Any future editorial UI must produce reviewable repository changes.
