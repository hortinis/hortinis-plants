# GROW/WFO initial curation dataset

- Status: in progress

This directory is the tracked C4 authoring boundary for decisions based on the pinned GROW 2020 and WFO
2026-06 runs. It intentionally contains no accepted records yet. A taxonomy candidate, source record, or
generated draft is not an accepted catalog assertion, crosswalk, or subject mapping.

Run `pnpm curate:grow-wfo:drafts` after successful `pnpm import:grow` and `pnpm import:wfo` runs. The
command writes deterministic, ignored review queues below `.cache/curation-drafts/grow-wfo/latest/`:

- `identity-review-queue.jsonl` has one WFO identity review item for every GROW source record;
- `subject-mapping-review-queue.jsonl` has one catalog-subject decision item for every GROW source record;
- `assertion-review-queue.jsonl` has every GROW assertion candidate, including source-location calendar
  windows; and
- `taxonomy-crosswalk-review-queue.jsonl` prepares consolidated WFO accepted-name, synonym and accepted-name
  target crosswalk drafts, pending a reviewed Hortinis taxon ID; and
- `geographic-context-review-queue.jsonl` groups calendar candidates by the country named by their GROW
  source location; and
- `curation-issues.jsonl` reports unresolved taxonomy and the absence of reviewed subject mappings.

The manifest declares all curator-owned JSON Lines collections and checksummed tracked source metadata.
The collections are intentionally zero-byte files until an explicit decision is applied. Its review
baseline pins the GROW and WFO configuration hashes plus the SHA-256 of the canonical draft manifest. The
draft manifest also verifies each queue's schema, record count, byte size and SHA-256.

After review, record decisions in the JSON Lines collections named by `dataset-manifest.json`. Decision
outcome, review status and supersession are separate: the newer record links to the older record it
supersedes. Do not copy generated queue records into those collections as accepted decisions without the
required review, source locator, rights, and scope checks.
