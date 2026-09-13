# Source adapter guide

An adapter converts one pinned source release into staged records through the shared importer runner. It
must not write a compiled consumer artifact or construct its own run manifest.

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

Adapters declare their input resources, output channels, schemas, semantic configuration and tool versions.
The runner verifies the source manifest and inputs, validates output records, writes canonical JSONL,
calculates output metadata and publishes the run manifest only after success. Detailed diagnostics are
stored in a diagnostics JSONL output. Fatal errors surface as a trace and leave no failed-run manifest.
Adapters must be deterministic, stream where practical, be independently testable and safe to rerun. Fail
closed when rights or required identity mappings are unknown.

## GROW Edible Plant Database adapter

The first source adapter is `src/adapters/grow`. Run it with `pnpm import:grow`, optionally passing an input directory and output directory after the script name. By default it reads the vendored release from `data/sources/grow/releases/2020`; it verifies the pinned GROW files, reads the derived Access CSV and the 12-location workbook, and writes deterministic staging JSONL beneath `.cache/import-runs/grow/latest`. It does not write consumer release artifacts.

The University of Dundee release is DOI `10.15132/10000157` (May 2020) and is declared CC BY 4.0. The adapter records that licence and generates attribution. GROW images are excluded because the source documentation states they were purchased under a separate licence. Its run manifest records the source manifest, all four upstream files, the derived CSV checksum and its `mdbtools` preparation command/version.

The Access ID is the only cross-resource join key. The pinned source data contains 140 plant records, although the release description says 146; the adapter reports this discrepancy and validates the known ID set. Workbook dates use year 2017 as a carrier and are emitted as month/day windows. Temperature values normalize to Celsius (`Cel`). Scalar optimum germination temperatures populate `optimum`; reported numeric ranges populate `minimum` and `maximum`; no midpoint or missing bound is inferred. Germination duration remains coupled to the reported germination temperature.

The calendar workbook identifies twelve representative locations and source strata. Their coordinates and source names are retained as source-location applicability; the adapter does not map them to Hortinis climate contexts. The catalog contract can represent “Sow outdoors / plant out” as `establish_outdoors` with the combined `direct_sowing_or_transplant` context. Preserve the original source field and never split it into direct sowing or transplanting. The GROW adapter still keeps records staged until their identity, context, timing anchor and rights are resolved; unmapped records remain candidates and diagnostics, not canonical assertions.
