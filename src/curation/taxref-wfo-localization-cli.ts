import { resolve } from "node:path";
import { reconcileTaxrefToReviewedWfo } from "./taxref-wfo-localization.js";

const result = await reconcileTaxrefToReviewedWfo({
  datasetDirectory: resolve(
    process.argv[2] ?? "data/curation/grow-wfo-initial",
  ),
  taxrefRunDirectory: resolve(
    process.argv[3] ?? ".cache/import-runs/taxref/latest",
  ),
  wfoRunDirectory: resolve(process.argv[4] ?? ".cache/import-runs/wfo/latest"),
  taxrefArchivePath: resolve(
    process.argv[5] ?? ".cache/source-inputs/taxref/18.0/TAXREF_v18_2025.zip",
  ),
  outputDirectory: resolve(
    process.argv[6] ?? ".cache/import-runs/taxref-wfo/latest",
  ),
});

console.log(JSON.stringify(result));
