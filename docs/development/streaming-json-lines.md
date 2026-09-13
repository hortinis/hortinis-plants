# Streaming JSON Lines

C1.9 provides bounded-memory JSON Lines input and output. The reader and writer operate on async
iterables so Node streams, generated records and tests can share the same boundary. Producers and
consumers advance together, preserving backpressure.

Each record is one UTF-8 JSON value followed by LF (`0x0a`). Streams have no byte-order mark, blank
lines, CRLF endings or unterminated final record. An empty stream is valid and contains zero records.
The reader accepts ordinary valid JSON with duplicate object keys rejected; it does not require
canonical whitespace or object-key order. The writer always uses the canonical JSON serializer and
ends every record with exactly one LF.

Input is scanned by byte and decoded one record at a time, so UTF-8 code points may cross input chunk
boundaries. The default encoded record limit is 16 MiB, excluding the LF delimiter. Callers can set
`maxLineBytes` to a different positive safe integer. Both read and write limits use encoded bytes.

Callers may provide one schema identifier and a validation API for the stream. Every record is
validated as it is read or before it is written. Processing stops at the first parsing, validation,
or serialization error. `JsonLinesError` reports a one-based line number, stable error code, and a
JSON Pointer or normalized schema errors when available. Schema registry and unknown-schema failures
are reported as validation-pipeline failures associated with that line.

The APIs do not retain a dataset. The reader retains at most one record plus the current source
chunk, and the writer retains one serialized record. Callers should consume yielded records or bytes
as they arrive; collecting the iterable in an array removes the bounded-memory property.
