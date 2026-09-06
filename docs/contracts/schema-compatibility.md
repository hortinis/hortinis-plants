# Schema compatibility

Optional additive fields are compatible when older consumers can ignore them. Removing fields, changing meaning or units, or changing identifier semantics is a schema-major change.

Releases declare a minimum consumer version. Hortinis must retain retired references when records leave an active profile; retirement or renaming must not invalidate personal history.
