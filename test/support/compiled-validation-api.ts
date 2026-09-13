import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createValidationApi,
  type ValidationApi,
} from "../../src/schema/validation-api.js";
import { compileSchemas } from "../../src/schema/schema-compiler.js";

let apiPromise: Promise<ValidationApi> | undefined;

export function getCompiledValidationApi(): Promise<ValidationApi> {
  apiPromise ??= createApi();
  return apiPromise;
}

async function createApi(): Promise<ValidationApi> {
  const outputDirectory = await mkdtemp(
    join(process.cwd(), "dist/importer-validation-"),
  );
  const outputFile = join(outputDirectory, "registry.cjs");
  await compileSchemas({ schemasDirectory: "schemas", outputFile });
  const imported = (await import(pathToFileURL(outputFile).href)) as {
    default: { validatorsBySchemaId: unknown };
  };
  return createValidationApi(imported.default.validatorsBySchemaId);
}
