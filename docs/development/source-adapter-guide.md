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

## GROW Edible Plant Database adapter

The first source adapter is `src/adapters/grow`. Run it with `pnpm import:grow`, optionally passing an input directory and output directory after the script name. By default it reads the vendored release from `data/sources/grow/releases/2020`; it verifies the pinned GROW files, reads the derived Access CSV and the 12-location workbook, and writes deterministic staging JSONL beneath `.cache/import-runs/grow/latest`. It does not write consumer release artifacts.

The University of Dundee release is DOI `10.15132/10000157` (May 2020) and is declared CC BY 4.0. The adapter records that licence and generates attribution. GROW images are excluded because the source documentation states they were purchased under a separate licence.

The Access ID is the only cross-resource join key. The pinned source data contains 140 plant records, although the release description says 146; the adapter reports this discrepancy and validates the known ID set. Workbook dates use year 2017 as a carrier and are emitted as month/day windows. Temperature values normalize to Celsius (`Cel`). Scalar optimum germination temperatures populate `optimum`; reported numeric ranges populate `minimum` and `maximum`; no midpoint or missing bound is inferred. Germination duration remains coupled to the reported germination temperature.

The calendar workbook identifies twelve representative locations and source strata. Their coordinates and source names are retained as source-location applicability; the adapter does not map them to Hortinis climate contexts. Preserve “Sow outdoors / plant out” as a combined, source-native operation. Do not infer direct sowing or transplanting; it remains a staged candidate until the catalog contract can represent that combined meaning. Unmapped records remain staged candidates and diagnostics, not canonical assertions.
