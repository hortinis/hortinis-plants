# Deterministic gzip

The V1 local-validation artifact builder compresses already-framed bytes with a pinned Node.js 24
zlib configuration. Compression uses the best zlib level, the default strategy, a fixed 32 KiB
window and fixed memory settings.

The gzip header has no optional fields. Its modification time is zeroed and its operating-system
marker is normalized to `255` so platform metadata cannot alter the artifact hash. The SHA-256
digest is calculated over the final compressed bytes and is emitted as lowercase hexadecimal.

The compressor reports the compressed byte size and receives the authoritative entry count from its
caller. JSON Lines framing, ordering and record counting are separate concerns and are not inferred
by this primitive. Streaming compression and hashing remain part of the later C1.9/C1.10 work.
