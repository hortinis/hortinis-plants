import { resolve } from "node:path";
import { importTaxrefSource } from "./adapter.js";

const archivePath = resolve(
  process.argv[2] ?? ".cache/source-inputs/taxref/18.0/TAXREF_v18_2025.zip",
);
const outputDirectory = resolve(
  process.argv[3] ?? ".cache/import-runs/taxref/latest",
);
const result = await importTaxrefSource({ archivePath, outputDirectory });
console.log(
  JSON.stringify({
    outputDirectory: result.outputDirectory,
    manifestSha256: result.manifestSha256,
  }),
);
