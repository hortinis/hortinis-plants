import { resolve } from "node:path";
import { generateIntegratedReviewPackets } from "./integrated-review-packets.js";

const result = await generateIntegratedReviewPackets({
  growRunDirectory: resolve(
    process.argv[2] ?? ".cache/import-runs/grow/latest",
  ),
  cropGraphRunDirectory: resolve(
    process.argv[3] ?? ".cache/import-runs/cropgraph/latest",
  ),
  wfoRunDirectory: resolve(process.argv[4] ?? ".cache/import-runs/wfo/latest"),
  taxrefWfoRunDirectory: resolve(
    process.argv[5] ?? ".cache/import-runs/taxref-wfo/latest",
  ),
  outputDirectory: resolve(
    process.argv[6] ?? ".cache/curation-drafts/integrated/latest",
  ),
});

console.log(JSON.stringify(result));
