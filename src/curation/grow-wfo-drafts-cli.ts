import { resolve } from "node:path";
import { generateGrowWfoDrafts } from "./grow-wfo-drafts.js";

const result = await generateGrowWfoDrafts({
  growRunDirectory: resolve(
    process.argv[2] ?? ".cache/import-runs/grow/latest",
  ),
  wfoRunDirectory: resolve(process.argv[3] ?? ".cache/import-runs/wfo/latest"),
  outputDirectory: resolve(
    process.argv[4] ?? ".cache/curation-drafts/grow-wfo/latest",
  ),
});

console.log(JSON.stringify(result));
