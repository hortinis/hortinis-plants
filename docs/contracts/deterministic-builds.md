# Deterministic builds

The same source releases, editorial files, tool versions and profile must produce identical entries, chunk order, hashes and attribution output.

Define stable ordering, canonical JSON, normalized newlines, fixed gzip settings and a reproducible timestamp policy. Manifest timestamps must not change entry or chunk hashes.

Determinism is verified by building twice from clean worktrees and comparing all generated checksums.
