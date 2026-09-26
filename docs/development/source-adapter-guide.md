# Source adapter guide

An adapter converts one pinned source release into staged records through the shared importer runner. It
must not write a compiled consumer artifact or construct its own run manifest. Cross-source reconciliation
jobs are separate from one-source adapters; when they consume multiple pinned releases or importer runs,
they use a reconciliation-specific manifest and retain the same validation, canonical serialization,
hashing, deterministic-output and atomic-publication requirements.

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

## WFO snapshot and GROW name reconciliation

The WFO adapter uses the pinned 2026-06 archive described in `data/sources/wfo/README.md` and
`source-manifest.json`. Download the exact `_DwC_backbone_R.zip` release to the ignored
`.cache/source-inputs/wfo/2026-06/` directory. The WFO release publishes MD5 and exact byte size;
the adapter checks both and records a SHA-256 for the exact snapshot in its reconciliation manifest.
It streams `classification.csv` from the ZIP and requires the documented Darwin Core columns.

Run `pnpm import:grow` first, then `pnpm import:wfo`. The WFO run reads every `source-records.jsonl`
record from the pinned GROW run, including names outside the catalog MVP. It emits one reviewable
candidate per GROW record. Only NFC normalization, trimming and collapsing whitespace are used for
automatic exact-name comparison. Exact accepted names and exact synonyms can yield candidates;
ambiguous, unplaced, unmatched and other-status names remain unresolved. No candidate is applied to a
catalog taxon, plant concept, cultivar group or cultivar.

The staged WFO taxonomy subset is limited to exact-name rows for all imported GROW records, referenced
accepted-name targets, synonyms that point to selected accepted names, and the corresponding genus and
family rows. It is a review/extraction subset, not a claim that WFO contains only those taxa and not a
consumer catalog release. WFO IDs remain external identifiers scoped by source and release. GROW source
record IDs remain independent, and no GROW-to-catalog subject mapping is emitted.

The staging output goes to `.cache/import-runs/wfo/latest`; it contains candidate JSONL, selected WFO
taxonomic rows, diagnostics and a deterministic run manifest. A WFO release update supersedes prior
reviewed crosswalks through explicit curation; it never silently carries or changes an accepted catalog
identity.

For later reconciliation, a reviewer records a source-name decision against the preserved, release-qualified
GROW source-record key and locator. If accepted, that decision references a reviewed WFO crosswalk keyed by
WFO source, release and identifier. A separate source-subject mapping then links the GROW record to a
Hortinis plant concept, cultivar group or cultivar when that horticultural identity is reviewed. The
taxonomy crosswalk alone never performs that subject mapping and never merges crop forms. Unmatched,
ambiguous and unplaced names remain unresolved until a reviewer records a decision; an exact-string
candidate is not itself an accepted crosswalk.

The reconciled staging JSONL is not the final catalog. C4 curation will author accepted Hortinis taxa
and scientific-name/synonym records, plant concepts and separate horticultural group/cultivar records;
C5 will project only reviewed, profile-eligible records into deterministic consumer releases.

## CropGraph raw staging

Run `pnpm import:cropgraph` to verify the four pinned resources and stream the CropGraph calendar through
the shared importer runner. The default output is `.cache/import-runs/cropgraph/latest/`. It contains all
5,006 raw source records, the same 5,006 selected records, an inventory, diagnostics and a run manifest.
The selected cohort is an explicit, fingerprinted list of every pinned slug; it is not a match to catalog
subjects or the France MVP allowlist. Source array positions appear only in provenance locators. The
release-qualified slug is the stable source record key.

The adapter validates against the pinned upstream entry schema and records a warning for each of the 21
pinned entries using `plant_now` in climate modifier `windowShifts`, which that schema omits. The exception
register pins the exact slugs and source checksums. Other schema errors, duplicate slugs, changed resources
and cohort gaps fail the run atomically. Entry-level source strings override the calendar-level citation;
both the effective string and its inheritance level are preserved. All entries remain pending commercial
rights review. Candidate extraction is described below; cultivation interpretation belongs to later curation tasks.

### CropGraph candidates (T11)

The same atomic run also writes `identity-candidates.jsonl` and `cultivation-candidates.jsonl`. Both have
compiled V1 schemas; the run manifest records their schema, byte size, count and SHA-256. The inventory adds
candidate counts and candidate diagnostic counts. Candidates are emitted per selected record, ordered by
source slug and then opaque candidate ID. Generated files remain under ignored `.cache` paths.

Every candidate carries a release-qualified record key, semantic claim key, exact occurrence locators, raw
value, extraction method, effective citation and citation locator, declared licence reference, `unreviewed`
content state and `pending-review` commercial rights. No authored subject, context or acceptance is created.
An absent entry citation inherits the calendar bibliography and emits `ENTRY_CITATION_ABSENT`. A present but
empty or whitespace-only citation remains an entry citation and emits `CITATION_UNUSABLE`; it does not silently
fall back to the bibliography. Neither citation form establishes rights in the underlying work.

Identity output preserves scientific labels, common names and aliases verbatim. Alias language and whether
an alias is common or scientific remain unknown. Every entry gets an unresolved subject-label candidate,
including its original slug, names and category. Explicit hints use only these documented patterns:

- A trailing single-quoted or curly-single-quoted epithet in the scientific label proposes a cultivar label.
- A whole word `microgreen`/`microgreens` in the common name, or a `microgreen-` slug prefix, flags microgreens.
- A whole word `sprout`/`sprouts` in a common name is flagged only with source category `sprout`.
- Whole words `mix`, `mixture` or `blend` in the common name flag a mixture; `Pollmix` does not match.
- `var.`, `subsp.` or `Group` followed by whitespace in the scientific label flags a crop-form review hint.

Hints are unreviewed source-label cues, not established taxonomic or horticultural identities. Other cultivar
and crop-form labels remain visible in the full unresolved subject label and notes. No automatic name
stripping, mixture decomposition, synonym acceptance or mature-crop inheritance is performed.

Cultivation windows preserve the original action, anchor, signed offsets and notes. `start_indoors`,
`direct_sow` and `transplant` map by identity; `plant_now` has a null catalog action and an unresolved action
mapping. Frost anchor spelling is normalized to the existing relative-day timing vocabulary without
calculating dates. Context retains `both` and `greenhouse`, leaves heating unknown, and records missing
context explicitly instead of assuming outdoor cultivation. Source category, season and USDA zone range are
source classifications, not French applicability or inferred lifecycle assertions.

Soil temperatures retain Fahrenheit and unresolved meaning, including an explicit null; absent temperature
fields emit no temperature candidate. Harvest ranges retain days with an unknown anchor. Notes remain text
candidates. Window notes link to their window; modifier notes retain their climate key and link to that
climate's shift candidates. Entry notes remain scoped by the qualified source record.

A modifier retains its climate, source action and week delta, plus every matching base-window candidate ID.
It remains unapplied. Zero or multiple distinct bases produce `MODIFIER_BASE_MISSING` or
`MODIFIER_BASE_AMBIGUOUS`; later review chooses applicability and bases. The pinned `plant_now` exception
register continues to apply. No climate, zone or runtime-code datasets are imported.

Semantic keys hash canonical claim content within a qualified source record and semantic field. Candidate
IDs never contain array positions or file paths. Exact duplicate aliases/windows share a candidate, retain
all occurrence locators and emit `DUPLICATE_SEMANTIC_CLAIM`. Different window notes make distinct claims.
Reordering changes locators and possibly hashes of output files, but not candidate identities. Changes to
claim content change the candidate ID; run fingerprints also track changed citations and other inputs.

Diagnostics deliberately recognize a limited set of prose patterns. An explicit `N-M weeks before last/first
frost` window note is compared to numeric offsets only when its anchor matches; disagreement preserves both
claims. Regional review flags recognize `long-day`, `short-day`, `day-length`, `California`, `southeast`,
`southwest` and degrees north. Every indoor frost-relative window is flagged for applicability review.
These checks do not establish that other prose is consistent or turn notes into numeric, geographic or
accepted facts. Greenhouse heating, numeric soil-temperature meaning, `plant_now` and harvest anchors have
separate unresolved diagnostics.
