# Schema compatibility

Optional additive fields are compatible when older consumers can ignore them. Removing fields, changing meaning or units, or changing identifier semantics is a schema-major change.

V1 public consumer records therefore permit additive top-level properties. Nested structures whose
members jointly define semantics, including artifact checksums, rights decisions and timing variants,
remain closed. A schema version is a semantic version, while its schema identifier contains the supported
major version. A V1 validator rejects manifests declaring another schema major.

New assertion predicates and cultivation-rule actions may be added within V1 when existing record
semantics remain unchanged. A release using a new value shape or action must declare a minimum consumer
version that understands it. Temperature-profile predicates use the structured `Cel` object contract;
harvest rules use the `harvest` action.

Releases declare a minimum consumer version. Hortinis must retain retired references when records leave an active profile; retirement or renaming must not invalidate personal history.
