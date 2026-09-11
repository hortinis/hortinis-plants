# Canonical JSON

Canonical JSON is the deterministic value boundary used by local artifacts. Values are serialized in a compact RFC 8785-compatible form: object member names are sorted by UTF-16 code-unit order, array order is preserved, and numbers use JavaScript JSON number serialization after rejecting non-finite values. Output is UTF-8 without a byte-order mark, whitespace, or a trailing newline. JSON Lines framing defines line endings separately.

Only JSON-domain values are accepted. Undefined, functions, symbols, bigint, non-finite numbers, cycles, sparse arrays, non-plain objects, accessors, symbol-keyed properties and lone Unicode surrogates are rejected with a JSON Pointer location.

Raw JSON parsing rejects duplicate object members, including members whose escaped spellings decode to the same name. It never silently applies a last-member-wins policy. Schema validation happens after parsing and canonicalization does not mutate input values.
