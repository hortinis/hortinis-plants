# ADR-0006: Release coordination

- Status: validated

## Decision

This repository is authoritative for the language-neutral catalog schema. Consumers may mirror generated schemas but must not redefine them.

Compressed JSON Lines chunks target approximately 1 MiB and must not exceed 2 MiB. The first release does not add artifact signatures or distribute signing keys. Authenticity relies on the trusted local selection or authenticated HTTPS channel defined by Hortinis ADR-0014; manifest SHA-256 hashes provide integrity relative to that source.

Publish a stable release quarterly when accepted changes exist. Publish an additional correction release when an urgent data or rights issue cannot wait for the next cadence. Do not publish empty scheduled releases.

Static climate-cell data does not ship in the plant catalog. Plan it as a separately versioned artifact in a separate `hortinis-climate` repository. The plant catalog may use stable semantic climate-context identifiers but must remain usable when no climate artifact is installed.

The MVP implements BCP 47 language-tagged names and deterministic fallback, initially exercising French and English. It excludes images.

## Consequences

Signing and key distribution remain deferred until an untrusted mirror, automatic remote update path or other threat model requires them. Climate data and future image packs have independent provenance, size, rights and update lifecycles.
