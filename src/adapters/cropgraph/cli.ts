import { resolve } from "node:path";
import { importCropGraphSource } from "./adapter.js";

const releaseId = "e722c3415bcf2773277f3422e13a4de5efd29b48";
const inputDirectory = resolve(
  process.argv[2] ?? `data/sources/cropgraph/releases/${releaseId}`,
);
const outputDirectory = resolve(
  process.argv[3] ?? ".cache/import-runs/cropgraph/latest",
);
const result = await importCropGraphSource({ inputDirectory, outputDirectory });
console.log(
  JSON.stringify({
    outputDirectory: result.outputDirectory,
    manifestSha256: result.manifestSha256,
  }),
);
