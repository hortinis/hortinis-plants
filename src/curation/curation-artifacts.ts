import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import {
  parseJsonStrict,
  serializeCanonicalJson,
} from "../serialization/canonical-json.js";
import { readJsonLines } from "../serialization/json-lines.js";
import type { ValidationApi } from "../schema/validation-api.js";
import type { DatasetRecord } from "./validation-dataset.js";

export type RecordValue = DatasetRecord;
export const CURATION_SCHEMA = "urn:hortinis:plants:schema:curation:v1:";
export const RUN_SCHEMA = "urn:hortinis:plants:schema:v1:";

export function object(value: unknown): RecordValue {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected a JSON object");
  return value as RecordValue;
}

export function records(value: unknown): RecordValue[] {
  if (!Array.isArray(value)) throw new Error("Expected an array of records");
  return value.map(object);
}

export function field(value: RecordValue, key: string): string {
  if (typeof value[key] !== "string" || value[key].length === 0)
    throw new Error(`Missing string field ${key}`);
  return value[key];
}

export function strings(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    throw new Error("Expected an array of strings");
  return value as string[];
}

export function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function contentDigest(value: unknown): string {
  return digest(serializeCanonicalJson(value));
}

export function same(left: unknown, right: unknown): boolean {
  return contentDigest(left) === contentDigest(right);
}

export function assertSchema(
  api: ValidationApi,
  schemaId: string,
  value: unknown,
): void {
  const result = api.validate(schemaId, value);
  if (!result.valid)
    throw new Error(`${schemaId}: ${JSON.stringify(result.errors)}`);
}

export async function readObject(
  path: string,
  api?: ValidationApi,
  schemaId?: string,
): Promise<RecordValue> {
  const value = object(parseJsonStrict(await readFile(path)));
  if (api !== undefined && schemaId !== undefined)
    assertSchema(api, schemaId, value);
  return value;
}

/** Paths named inside manifests are relative to their declared root, including symlinks. */
export async function containedPath(
  root: string,
  path: string,
): Promise<string> {
  if (
    isAbsolute(path) ||
    path.includes("\\") ||
    path.split("/").some((part) => part === ".." || part === "")
  )
    throw new Error(`Unsafe artifact path ${path}`);
  const actualRoot = await realpath(root);
  const actual = await realpath(resolve(actualRoot, path));
  const suffix = relative(actualRoot, actual);
  if (
    suffix === "" ||
    suffix === ".." ||
    suffix.startsWith("../") ||
    isAbsolute(suffix)
  )
    throw new Error(`Artifact escapes its root: ${path}`);
  return actual;
}

export async function verifyArtifact(
  path: string,
  descriptor: RecordValue,
  api: ValidationApi,
  format: "json" | "jsonl" | "bytes",
  collect = false,
  onRecord?: (record: RecordValue) => void,
): Promise<RecordValue[]> {
  const hash = createHash("sha256");
  let byteSize = 0;
  for await (const chunk of createReadStream(path)) {
    const bytes = chunk as Buffer;
    hash.update(bytes);
    byteSize += bytes.byteLength;
  }
  if (
    hash.digest("hex") !== descriptor.sha256 ||
    byteSize !== descriptor.byteSize
  )
    throw new Error(`Checksum or byte size differs from descriptor: ${path}`);
  const schemaId =
    typeof descriptor.schemaId === "string" ? descriptor.schemaId : undefined;
  const result: RecordValue[] = [];
  let count = 0;
  if (format === "json") {
    const value = await readObject(path, api, schemaId);
    count = 1;
    if (collect) result.push(value);
  } else if (format === "jsonl") {
    for await (const row of readJsonLines(createReadStream(path), {
      ...(schemaId === undefined ? {} : { schemaId, validationApi: api }),
    })) {
      count += 1;
      if (onRecord !== undefined) onRecord(object(row.value));
      if (collect) result.push(object(row.value));
    }
  }
  if (
    format !== "bytes" &&
    descriptor.recordCount !== undefined &&
    descriptor.recordCount !== count
  )
    throw new Error(`Record count differs from descriptor: ${path}`);
  return result;
}

export function uniqueBy(
  values: readonly RecordValue[],
  key: (value: RecordValue) => string,
): Map<string, RecordValue> {
  const result = new Map<string, RecordValue>();
  for (const value of values) {
    const id = key(value);
    if (result.has(id)) throw new Error(`Duplicate key ${id}`);
    result.set(id, value);
  }
  return result;
}
