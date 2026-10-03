# Coverage report

Each release must produce a coverage report showing:

- plants with accepted identity;
- plants with French names;
- plants with usable cold-sensitivity information;
- plants with planting or transplant rules;
- plants scoped to each supported production system;
- plants with unresolved or contradictory assertions;
- excluded records and licence reasons;
- preferred-name coverage by BCP 47 language tag, initially French and English;
- generic plant concepts with only cultivar-scoped evidence;
- source and geographic coverage.

Coverage percentages must state the denominator. A missing field means missing knowledge, not a negative recommendation.

T19 authoring coverage is available through `pnpm curate:status -- --json` under `coverage`.
It reports GROW's 140 records, the 5,006 selected CropGraph records, 33 MVP concept targets and two
cultivar exemplars independently. Candidate families and actions retain accepted, rejected, deferred
and pending counts. Missing frozen inputs have null source denominators. Target labels require explicit
reviewed subject bindings; cultivar evidence does not fill generic-concept gaps.

`coverage.readiness` applies the [C4 completion policy](../development/curation-runbook.md).
Commercial assertion counts require accepted rights reviews and commercially allowed licences for every
evidence reference. Source-backed authoring coverage does not establish French applicability or a
release profile's eligibility. Those gates, consumer fallback and inheritance remain C5 work.
