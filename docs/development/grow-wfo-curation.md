# GROW/WFO C4 curation workflow

- Status: in progress

The first broad catalog curation set uses every record from the pinned GROW 2020 import and the pinned WFO
2026-06 reconciliation. It is source-location-qualified and is not a France-specific release profile.

## Generate the review queue

Run the two source jobs, then generate the C4 queue:

```sh
pnpm import:grow
pnpm import:wfo
pnpm curate:grow-wfo:drafts
```

The drafts remain ignored cache files. They are a deterministic review aid and carry `reviewState:
"unreviewed"`; they are never consumer catalog records.

## Authoring decisions

For each reviewed WFO outcome, author an external taxonomy crosswalk. Then author a source-name decision
for its GROW record and, separately, a source-subject mapping to a reviewed Hortinis plant concept,
cultivar group, or cultivar. The crosswalk never maps a GROW record by itself.

Only after the identity and subject decisions are reviewed may a GROW candidate become an assertion. Each
assertion retains evidence of the source record and locator. Repeated source records remain separate claims
until a reviewer explicitly determines their subject scope and any contradiction.

The current C4 decision scopes GROW calendar candidates to the country named by their source location;
the named location and strata remain preserved in evidence. `outdoor_sowing_or_planting` maps only to the
source-native combined `establish_outdoors` action with
`direct_sowing_or_transplant` propagation; it must not be split. Harvest-duration candidates remain
unreviewed until their source anchor is decided.

The current C4 temperature-class decision prepares the following authoring assertion drafts. It retains the
original class and normalization method in evidence; it does not create a numeric frost threshold.

| GROW source class | Draft `frost_sensitivity` value                 |
| ----------------- | ----------------------------------------------- |
| `Very tender`     | `sensitive`                                     |
| `Tender`          | `sensitive`                                     |
| `Half hardy`      | `unknown`                                       |
| `Hardy`           | `hardy`                                         |
| `Very hardy`      | `hardy`                                         |
| `Very hard`       | `hardy` after documented spelling normalization |

## Required questions for editorial review

1. For each ambiguous, unmatched, or unresolved WFO candidate: is there a documented manual match,
   documented correction, or accepted limitation?
2. For repeated scientific names and named crop forms: do records share one plant concept, represent
   separate plant concepts, or belong to a cultivar group?
3. Is “country” intended to mean the country named by the GROW calendar location, rather than the plant's
   botanical native country? The source spelling `Irland` also needs a documented normalized country name.
