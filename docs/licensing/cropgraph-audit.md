# CropGraph licence and provenance audit

Status: `in progress` for assertion-level rights review. The source pin and file-level licence recording are
`validated`; the licence review itself remains `unreviewed`.

Hortinis pins CropGraph commit `e722c3415bcf2773277f3422e13a4de5efd29b48`. The exact acquired resources,
checksums, citation inheritance and exclusions are documented in the
[CropGraph source package](../../data/sources/cropgraph/README.md).

## Licence scopes

The pinned `crop-calendar.json` declares `CC-BY-4.0`. The repository `LICENSE` and core package README declare
MIT for CropGraph software. These declarations have different scopes: the data declaration does not relicense
software, and the software licence does not establish rights in the calendar or in material cited by calendar
entries. Hortinis imports no CropGraph runtime code.

The declared file licence does not by itself prove that every upstream source permits redistribution. The
calendar includes source strings for extension organizations, books, catalogs, yearbooks, seed vendors,
nurseries and other material. None of the 2,209 distinct entry-level source strings is a URL, and 150 entries
inherit the broad file-level bibliography instead of naming an entry-level source.

Before an assertion enters a commercial profile, its effective citation must identify an exact work closely
enough to check that the work supports the assertion and permits the intended use. Catalog or bibliography
descriptions must not be treated as a rights grant. Until that review is accepted, the calendar is candidate
evidence for `dev-validation` and remains `pending-review` for `commercial` releases.

## Included scope

The current pin includes only the crop calendar, its JSON Schema, the repository licence and the core README.
Companion, rotation, succession, pest, beneficial-insect, GDD, climate, zone and software assets are explicitly
excluded. T10 will inventory the pinned calendar and freeze a record-level cohort; this audit does not select
records or resolve ambiguous cultivation semantics.
