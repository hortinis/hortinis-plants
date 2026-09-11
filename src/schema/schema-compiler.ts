import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import * as standaloneCodeModule from "ajv/dist/standalone/index.js";
import type { AnySchema } from "ajv/dist/types/index.js";

type StandaloneCode = (ajv: Ajv2020, refs: Record<string, string>) => string;
const standaloneCode = (
  standaloneCodeModule as unknown as { default: StandaloneCode }
).default;

export interface SchemaDocument {
  readonly filePath: string;
  readonly schema: AnySchema & { $id: string };
}

export interface CompileSchemasOptions {
  readonly schemasDirectory: string;
  readonly outputFile: string;
}

export async function discoverSchemas(
  schemasDirectory: string,
): Promise<SchemaDocument[]> {
  const filePaths = await findSchemaFiles(resolve(schemasDirectory));
  const documents: SchemaDocument[] = [];

  for (const filePath of filePaths) {
    const source = await readFile(filePath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(source) as unknown;
    } catch (error) {
      throw new Error(`Invalid JSON in schema ${filePath}`, { cause: error });
    }

    if (!isSchemaWithId(parsed)) {
      throw new Error(
        `Schema ${filePath} must declare a non-empty absolute $id`,
      );
    }
    documents.push({ filePath, schema: parsed });
  }

  documents.sort((left, right) =>
    left.schema.$id.localeCompare(right.schema.$id),
  );
  const identifiers = new Map<string, string>();
  for (const document of documents) {
    const previousPath = identifiers.get(document.schema.$id);
    if (previousPath !== undefined) {
      throw new Error(
        `Duplicate schema identifier ${document.schema.$id} in ${previousPath} and ${document.filePath}`,
      );
    }
    identifiers.set(document.schema.$id, document.filePath);
  }
  return documents;
}

export async function compileSchemas({
  schemasDirectory,
  outputFile,
}: CompileSchemasOptions): Promise<SchemaDocument[]> {
  const documents = await discoverSchemas(schemasDirectory);
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    validateSchema: true,
    code: { esm: false, source: true },
    coerceTypes: false,
    useDefaults: false,
    removeAdditional: false,
  });

  for (const document of documents) {
    ajv.addSchema(document.schema, document.schema.$id);
  }
  for (const document of documents) {
    if (ajv.getSchema(document.schema.$id) === undefined) {
      throw new Error(`Schema ${document.schema.$id} was not registered`);
    }
  }

  const exportNames = new Map<string, string>();
  const exports: Record<string, string> = {};
  for (const [index, document] of documents.entries()) {
    const exportName = `validateSchema${index}`;
    exportNames.set(document.schema.$id, exportName);
    exports[exportName] = document.schema.$id;
  }
  const generated = standaloneCode(ajv, exports);
  const registry = [
    generated.trimEnd(),
    "",
    "module.exports.validatorsBySchemaId = Object.freeze({",
    ...documents.map(
      (document) =>
        `  ${JSON.stringify(document.schema.$id)}: exports.${exportNames.get(document.schema.$id)},`,
    ),
    "});",
    "",
  ].join("\n");

  await mkdir(dirname(outputFile), { recursive: true });
  await writeFile(outputFile, registry, "utf8");
  return documents;
}

async function findSchemaFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findSchemaFiles(path)));
    } else if (entry.isFile() && entry.name.endsWith(".schema.json")) {
      files.push(path);
    }
  }
  return files.sort((left, right) =>
    relative(directory, left).localeCompare(relative(directory, right)),
  );
}

function isSchemaWithId(value: unknown): value is AnySchema & { $id: string } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const identifier = (value as { $id?: unknown }).$id;
  if (typeof identifier !== "string" || identifier.length === 0) {
    return false;
  }
  try {
    return new URL(identifier).protocol.length > 0;
  } catch {
    return false;
  }
}
