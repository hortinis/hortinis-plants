# Source adapter guide

An adapter converts one pinned source release into normalized assertions. It must not write a compiled consumer artifact.

Each adapter records:

- source and release identifiers;
- original record identifier;
- exact source locator;
- original value;
- normalized value and unit;
- applicability context;
- licence decision;
- extraction method;
- warnings and unresolved mappings.

Adapters must be deterministic, stream where practical, be independently testable and safe to rerun. Fail closed when rights or required identity mappings are unknown.
