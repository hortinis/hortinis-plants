# Deterministic gzip

The V1 local-validation artifact builder compresses already-framed bytes with a pinned Node.js 24
zlib configuration. Compression uses the best zlib level, the default strategy, a fixed 32 KiB
window and fixed memory settings. The same options apply to both the in-memory and streaming APIs.

The gzip header has no optional fields. Its modification time is zeroed and its operating-system
marker is normalized to `255` so platform metadata cannot alter the artifact hash. The SHA-256
digest is calculated over the final compressed bytes and is emitted as lowercase hexadecimal.

The in-memory compressor reports the compressed byte size and receives the authoritative entry count
from its caller. JSON Lines framing, ordering and record counting remain separate concerns.

The streaming compressor applies the same header normalization before forwarding compressed bytes
to the destination or updating SHA-256. It counts compressed bytes and hashes the final normalized
gzip representation incrementally. Its caller supplies the entry count; the combined JSON Lines
writer counts records as it frames them. Different input chunk boundaries must produce identical
gzip bytes. Empty input produces a valid deterministic gzip stream with zero entries.

Streaming operations propagate source, compression and destination errors. A destination can contain
a partial artifact after an error, so the caller must discard it and publish metadata only after the
operation resolves successfully. Successful results contain the lowercase SHA-256 digest, compressed
byte size and authoritative entry count without retaining the complete input or output.
