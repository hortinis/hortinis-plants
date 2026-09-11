# Source-manifest contract

A source manifest describes one pinned upstream release. It records what was acquired and the review
decisions that permit or prevent that release from entering a profile. It is build provenance, not a
normalized catalog dataset.

The versioned JSON Schema is `urn:hortinis:plants:schema:v1:source-manifest`. Its `id` is a stable
catalog-owned identifier. It is independent of a source filename, array position, download URL, or
provider's record identifiers. Other contracts reference it through the stable
`source-manifest-reference` schema.

Each manifest records:

- the provider identifier and human-readable name;
- the provider release identifier;
- every acquired resource, its locator, and a lowercase SHA-256 checksum;
- the declared licence and the licence-review evidence and state; and
- an explicit eligibility decision and reason for each relevant release profile.

The manifest may include resource byte sizes and media types, but these are descriptive metadata and do
not replace checksums. A release with unknown or unsupported rights remains ineligible under the
licensing policy; a file-level declaration is not proof of rights in every upstream record.

The source manifest does not contain normalized assertions, source records, consumer projections,
attribution output, or importer-run results. Assertions retain their own source-release ID, source-record
ID, locator, original value, rights decision, and review state. A later importer run manifest records the
transformation from this pinned input.

The schema deliberately validates identifier shape and references, but does not resolve an identifier to
an on-disk manifest. Artifact-level reference resolution belongs to the V1.3 builder.
