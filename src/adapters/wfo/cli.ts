import { resolve } from "node:path";
import { WFO_SNAPSHOT_FILENAME } from "./constants.js";
import { importWfoSnapshot } from "./adapter.js";

const growRunDirectory = resolve(
  process.argv[2] ?? ".cache/import-runs/grow/latest",
);
const snapshotPath = resolve(
  process.argv[3] ??
    `.cache/source-inputs/wfo/2026-06/${WFO_SNAPSHOT_FILENAME}`,
);
const outputDirectory = resolve(
  process.argv[4] ?? ".cache/import-runs/wfo/latest",
);

const result = await importWfoSnapshot({
  growRunDirectory,
  snapshotPath,
  outputDirectory,
});
console.log(
  JSON.stringify({
    outputDirectory,
    counts: result.manifest.counts,
    outcomes: Object.fromEntries(
      [
        "candidate-accepted",
        "candidate-synonym",
        "ambiguous",
        "unplaced",
        "unresolved-status",
        "unmatched",
      ].map((outcome) => [
        outcome,
        result.candidates.filter((candidate) => candidate.outcome === outcome)
          .length,
      ]),
    ),
  }),
);
