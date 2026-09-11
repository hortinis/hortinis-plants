import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { compileSchemas } from "./schema-compiler.js";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const schemasDirectory = resolve(repositoryRoot, "schemas");
const outputFile = resolve(
  repositoryRoot,
  "dist/generated/schema-registry.cjs",
);

await mkdir(dirname(outputFile), { recursive: true });
const documents = await compileSchemas({ schemasDirectory, outputFile });
console.log(`Compiled ${documents.length} schema(s) to ${outputFile}`);
