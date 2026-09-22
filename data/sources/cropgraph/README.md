# CropGraph source package

This package pins CropGraph commit
`e722c3415bcf2773277f3422e13a4de5efd29b48`, committed on 2026-08-06. The selected
upstream bytes are vendored beneath
`releases/e722c3415bcf2773277f3422e13a4de5efd29b48/` so the pin can be verified
without network access.

The pin is a Git commit, not a package-version claim. At this commit the core package reports version
`3.4.0`, while `git describe` yields `v3.0.0-7-ge722c34` and no tag contains the commit. The exact commit
identifier is therefore the source release identifier.

## Included resources

| Upstream path                                      |     Bytes | SHA-256                                                            | Purpose                                  |
| -------------------------------------------------- | --------: | ------------------------------------------------------------------ | ---------------------------------------- |
| `packages/core/src/data/crop-calendar.json`        | 4,293,185 | `09fc2f3f56143593578e64007756bce51cf6824ae3b3a265e7242970fb508fb7` | Candidate calendar data                  |
| `packages/core/src/data/crop-calendar.schema.json` |    10,474 | `e1a478533f4157863870e73bdd66490ee429fa22a8d366fcf70a7ce844abfc30` | Upstream structural contract             |
| `LICENSE`                                          |     1,074 | `106c59eefa7f30840e255d4157a174ec17b9e540f2473d9e37faf350006a75b5` | Software-licence evidence                |
| `packages/core/README.md`                          |     7,964 | `67b1954c71a27fda8f4aba8bcae5465e7d00f7131dace3aa00fc4dc4bdf0c62a` | Upstream scope, count and licence claims |

From `data/sources/cropgraph`, verify the local bytes with:

```sh
cd releases/e722c3415bcf2773277f3422e13a4de5efd29b48
sha256sum \
  LICENSE \
  packages/core/README.md \
  packages/core/src/data/crop-calendar.json \
  packages/core/src/data/crop-calendar.schema.json
```

The expected values and byte sizes are also recorded in `source-manifest.json`. A CropGraph importer must
declare these pinned resources through the shared importer runner so every checksum is verified before the
calendar is parsed.

## Citation inheritance

The calendar contains 5,006 entries. Of those, 4,856 have an entry-level `source` string and 150 omit it. An
entry-level source is the effective citation when present. Otherwise the entry inherits the calendar's
top-level `source` string verbatim. The importer must retain both the effective citation and whether it was
entry-level or inherited; it must not split, normalize, resolve or strengthen these strings automatically.

The pin contains 2,209 distinct non-empty entry-level source strings and none is a URL. Many identify a
publication class or organization rather than an exact work. Approximately 2,088 entries mention a catalog,
yearbook, seed vendor, nursery or descriptor. These strings are discovery and review evidence, not proof that
the underlying material supports the assertion or permits commercial redistribution.

The upstream core README says the calendar has 2,000 entries in one table, while the root README and the
pinned calendar contain 5,006. Hortinis records the count from the exact calendar bytes and does not repair the
upstream documentation.

## Licence scopes and release eligibility

`crop-calendar.json` declares its data as `CC-BY-4.0`. The repository `LICENSE` and core README declare MIT for
the software. Hortinis records these as separate scopes: the data licence does not relicense CropGraph code,
and the MIT software licence does not establish rights in calendar data or its cited upstream material. No
CropGraph runtime code is imported.

The exact bytes are eligible for the `dev-validation` profile as candidate evidence. They remain
`pending-review` for the `commercial` profile until the effective citation for each included assertion is
identified, checked for factual support and reviewed for the intended use. A file-level declaration is not a
blanket rights decision for upstream books, extension material, catalogs or other cited works.

## Explicit exclusions

This pin includes only the crop calendar, its matching schema and the two licence/scope evidence files above.
The following upstream assets are excluded from this source package and from the future CropGraph calendar
import unless a later planned task explicitly adds and audits them:

- companion relationships;
- rotation families;
- succession chains;
- pest and disease associations and species data;
- beneficial insects and pest relationship maps;
- growing-degree-day models and climate normals;
- USDA zone data and climate-classification logic;
- CropGraph library, CLI, MCP and build/runtime code; and
- generated npm packages, compiled output and service/API responses.

This resource exclusion is not the crop cohort decision. T10 inventories the full pinned calendar and freezes
the selected record cohort in a separate inclusion/exclusion file with its own rationale and fingerprint. T8
does not select records or interpret ambiguous calendar semantics.
