import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import * as nodeStream from "node:stream";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { parser } from "stream-json";
import { ignore } from "stream-json/filters/ignore.js";
import { pick } from "stream-json/filters/pick.js";
import { streamArray } from "stream-json/streamers/stream-array.js";
import { streamObject } from "stream-json/streamers/stream-object.js";
import { runImporter } from "../../importer/runner.js";
import type { ImportEvent, ImporterDefinition } from "../../importer/types.js";
import { serializeCanonicalJson } from "../../serialization/canonical-json.js";
import type { ValidationApi } from "../../schema/validation-api.js";

const releaseId = "e722c3415bcf2773277f3422e13a4de5efd29b48";
const sourceManifestId = "source_manifest_cropgraph";
const sourceId = "source_cropgraph";
const calendarLocator = "packages/core/src/data/crop-calendar.json";
const schemaLocator = "packages/core/src/data/crop-calendar.schema.json";
const manifestPath = fileURLToPath(
  new URL(
    "../../../data/sources/cropgraph/source-manifest.json",
    import.meta.url,
  ),
);
const cohortPath = fileURLToPath(
  new URL("../../../data/sources/cropgraph/cohort.json", import.meta.url),
);
const exceptionsPath = fileURLToPath(
  new URL(
    "../../../data/sources/cropgraph/schema-exceptions.json",
    import.meta.url,
  ),
);
const inventoryPath = fileURLToPath(
  new URL(
    "../../../data/sources/cropgraph/resource-inventory.json",
    import.meta.url,
  ),
);
const rawSchemaId = "urn:hortinis:plants:schema:v1:cropgraph-raw-record";
const diagnosticSchemaId = "urn:hortinis:plants:schema:v1:import-diagnostic";

interface Cohort {
  readonly sourceReleaseId: string;
  readonly calendarSha256: string;
  readonly rationale: string;
  readonly include: readonly string[];
  readonly exclude: readonly {
    readonly slug: string;
    readonly reason: string;
  }[];
  readonly fingerprint: string;
}

interface Entry {
  readonly slug: string;
  readonly source?: string;
  readonly [key: string]: unknown;
}

interface SchemaExceptions {
  readonly calendarSha256: string;
  readonly schemaSha256: string;
  readonly plantNowModifierSlugs: readonly string[];
}

interface ResourceInventory {
  readonly sourceReleaseId: string;
  readonly commitId: string;
  readonly includedPaths: readonly string[];
  readonly excludedPaths: readonly string[];
  readonly reason: string;
}

export interface CropGraphImportOptions {
  readonly inputDirectory: string;
  readonly outputDirectory: string;
  readonly cohortFile?: string;
  readonly schemaExceptionsFile?: string;
  readonly sourceManifestPath?: string;
  readonly validationApi?: ValidationApi;
}

export async function importCropGraphSource(options: CropGraphImportOptions) {
  const sourceManifestPath = options.sourceManifestPath ?? manifestPath;
  const cohortFile = options.cohortFile ?? cohortPath;
  const cohortBytes = await readFile(cohortFile);
  const cohort = JSON.parse(cohortBytes.toString("utf8")) as Cohort;
  const cohortSha256 = digest(cohortBytes);
  const exceptionsBytes = await readFile(
    options.schemaExceptionsFile ?? exceptionsPath,
  );
  const exceptions = JSON.parse(
    exceptionsBytes.toString("utf8"),
  ) as SchemaExceptions;
  const inventoryBytes = await readFile(inventoryPath);
  const resourceInventory = JSON.parse(
    inventoryBytes.toString("utf8"),
  ) as ResourceInventory;
  const importer: ImporterDefinition<{
    readonly cohortSha256: string;
    readonly exceptionsSha256: string;
    readonly resourceInventorySha256: string;
  }> = {
    name: "cropgraph-raw-staging",
    version: "0.1.0",
    configuration: {
      cohortSha256,
      exceptionsSha256: digest(exceptionsBytes),
      resourceInventorySha256: digest(inventoryBytes),
    },
    inputs: [
      calendarLocator,
      schemaLocator,
      "LICENSE",
      "packages/core/README.md",
    ].map((locator) => ({
      locator,
      path: locator,
      role: "upstream" as const,
    })),
    outputs: [
      {
        name: "source-records",
        path: "source-records.jsonl",
        role: "auxiliary",
        mediaType: "application/jsonl",
        schemaId: rawSchemaId,
      },
      {
        name: "selected-records",
        path: "selected-records.jsonl",
        role: "auxiliary",
        mediaType: "application/jsonl",
        schemaId: rawSchemaId,
      },
      {
        name: "inventory",
        path: "inventory.jsonl",
        role: "auxiliary",
        mediaType: "application/jsonl",
      },
      {
        name: "diagnostics",
        path: "diagnostics.jsonl",
        role: "diagnostics",
        mediaType: "application/jsonl",
        schemaId: diagnosticSchemaId,
      },
    ],
    tools: { streamJson: "3.7.0", ajv: "8.20.0" },
    async *run(context): AsyncIterable<ImportEvent> {
      const manifest = context.sourceManifest as {
        id?: string;
        release?: { identifier?: string };
        resources?: readonly {
          locator?: string;
          checksum?: { value?: string };
        }[];
      };
      if (
        manifest.id !== sourceManifestId ||
        manifest.release?.identifier !== releaseId
      ) {
        throw new Error(
          "CropGraph source manifest identity or release changed",
        );
      }
      const calendarSha256 = manifest.resources?.find(
        (resource) => resource.locator === calendarLocator,
      )?.checksum?.value;
      const schemaSha256 = manifest.resources?.find(
        (resource) => resource.locator === schemaLocator,
      )?.checksum?.value;
      if (calendarSha256 === undefined)
        throw new Error("CropGraph calendar checksum is absent");
      if (
        schemaSha256 === undefined ||
        exceptions.calendarSha256 !== calendarSha256 ||
        exceptions.schemaSha256 !== schemaSha256 ||
        !sorted(exceptions.plantNowModifierSlugs) ||
        new Set(exceptions.plantNowModifierSlugs).size !==
          exceptions.plantNowModifierSlugs.length
      )
        throw new Error(
          "CropGraph schema exception register does not match the pinned resources",
        );
      const declaredPaths = (manifest.resources ?? [])
        .map((resource) => resource.locator)
        .sort();
      if (
        resourceInventory.sourceReleaseId !== releaseId ||
        resourceInventory.commitId !== releaseId ||
        !resourceInventory.reason ||
        !sorted(resourceInventory.includedPaths) ||
        !sorted(resourceInventory.excludedPaths) ||
        resourceInventory.includedPaths.join("\n") !==
          declaredPaths.join("\n") ||
        resourceInventory.excludedPaths.some((path) =>
          resourceInventory.includedPaths.includes(path),
        )
      )
        throw new Error(
          "CropGraph resource inventory does not match the pinned manifest",
        );
      validateCohort(cohort, calendarSha256);
      const calendarPath = context.resourcePath(calendarLocator);
      const schema = JSON.parse(
        await readFile(context.resourcePath(schemaLocator), "utf8"),
      ) as { $id: string };
      const ajv = new Ajv2020({
        strict: true,
        allErrors: true,
        validateFormats: false,
      });
      ajv.addSchema(schema);
      const validateEntry = ajv.getSchema(`${schema.$id}#/$defs/Entry`);
      if (validateEntry === undefined)
        throw new Error("Pinned CropGraph schema has no Entry definition");
      const metadata = await readMetadata(calendarPath);
      if (
        metadata.version !== "2" ||
        metadata.license !== "CC-BY-4.0" ||
        typeof metadata.source !== "string" ||
        metadata.source.length === 0 ||
        metadata.lastUpdated !== "2026-05-13"
      ) {
        throw new Error(
          "Pinned CropGraph calendar metadata changed or is malformed",
        );
      }
      const records: { slug: string; value: Record<string, unknown> }[] = [];
      const seen = new Set<string>();
      const encounteredExceptions = new Set<string>();
      const diagnostics: Record<string, unknown>[] = [];
      const permittedExceptions = new Set(exceptions.plantNowModifierSlugs);
      const source = { sourceId, sourceManifestId, sourceReleaseId: releaseId };
      const stream = composeStreams(
        createReadStream(calendarPath),
        parser.asStream(),
        pick.asStream({ filter: "entries" }),
        streamArray.asStream(),
      );
      for await (const item of stream) {
        const { key: index, value } = item as { key: number; value: unknown };
        if (!validateEntry(value)) {
          const entry = value as Partial<Entry>;
          const errors = validateEntry.errors ?? [];
          if (
            typeof entry.slug !== "string" ||
            !permittedExceptions.has(entry.slug) ||
            errors.length === 0 ||
            !errors.every(
              (error) =>
                error.keyword === "additionalProperties" &&
                error.params.additionalProperty === "plant_now" &&
                /^\/climateModifiers\/(maritime|mediterranean|continental|humid_subtropical|arid|semi_arid)\/windowShifts$/u.test(
                  error.instancePath,
                ),
            ) ||
            !validPlantNowShifts(entry)
          ) {
            throw new Error(
              `Invalid CropGraph entry at /entries/${index}: ${JSON.stringify(errors)}`,
            );
          }
          encounteredExceptions.add(entry.slug);
          diagnostics.push({
            kind: "warning",
            code: "PINNED_SCHEMA_OMITS_PLANT_NOW_MODIFIER",
            message:
              "The pinned CropGraph schema excludes plant_now from climate windowShifts; the raw entry is retained without interpretation.",
            sourceRecordKey: {
              source: {
                sourceId,
                sourceManifestId,
                sourceReleaseId: releaseId,
              },
              recordId: entry.slug,
            },
            sourceRecordId: entry.slug,
            sourceLocator: `${calendarLocator}#/entries/${index}`,
            details: {
              schemaErrors: errors.map((error) => ({
                instancePath: error.instancePath,
                keyword: error.keyword,
              })),
            },
          });
        }
        const entry = value as Entry;
        if (seen.has(entry.slug))
          throw new Error(
            `Duplicate CropGraph slug ${entry.slug} at /entries/${index}`,
          );
        seen.add(entry.slug);
        if (
          rangeReversed(entry.daysToHarvest) ||
          rangeReversed(entry.zoneRange) ||
          (Array.isArray(entry.windows) &&
            entry.windows.some(
              (window) =>
                isObject(window) &&
                typeof window.fromFrostDays === "number" &&
                typeof window.toFrostDays === "number" &&
                window.fromFrostDays > window.toFrostDays,
            ))
        ) {
          throw new Error(
            `Reversed CropGraph range at /entries/${index} (${entry.slug})`,
          );
        }
        const valueOut = {
          sourceRecordKey: { source, recordId: entry.slug },
          sourceLocator: `${calendarLocator}#/entries/${index}`,
          originalIndex: index,
          rawEntry: entry,
          effectiveCitation: entry.source ?? metadata.source,
          citationLevel: entry.source === undefined ? "calendar" : "entry",
          declaredLicence: metadata.license,
          commercialRights: "pending-review",
        };
        records.push({ slug: entry.slug, value: valueOut });
      }
      records.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
      if (
        encounteredExceptions.size !== permittedExceptions.size ||
        [...permittedExceptions].some(
          (slug) => !encounteredExceptions.has(slug),
        )
      )
        throw new Error("CropGraph pinned schema exception set changed");
      const actual = records.map((record) => record.slug);
      const expected = [
        ...cohort.include,
        ...cohort.exclude.map((item) => item.slug),
      ].sort();
      if (
        actual.length !== expected.length ||
        actual.some((slug, index) => slug !== expected[index])
      ) {
        throw new Error(
          "CropGraph cohort does not account for every pinned calendar slug",
        );
      }
      const included = new Set(cohort.include);
      for (const record of records) {
        yield { output: "source-records", value: record.value };
        if (included.has(record.slug))
          yield { output: "selected-records", value: record.value };
      }
      diagnostics.sort((a, b) =>
        String(a.sourceRecordId).localeCompare(String(b.sourceRecordId), "en"),
      );
      for (const diagnostic of diagnostics)
        yield { output: "diagnostics", value: diagnostic };
      yield {
        output: "inventory",
        value: {
          sourceReleaseId: releaseId,
          calendarSha256,
          cohortFingerprint: cohort.fingerprint,
          totalRecords: records.length,
          includedRecords: cohort.include.length,
          excludedRecords: cohort.exclude.length,
          pinnedSchemaExceptions: diagnostics.length,
          metadata,
          includedResources: resourceInventory.includedPaths,
          excludedResources: resourceInventory.excludedPaths,
          resourceInventoryReason: resourceInventory.reason,
        },
      };
    },
  };
  return runImporter({
    importer,
    sourceManifestPath,
    resourceDirectory: resolve(options.inputDirectory),
    outputDirectory: resolve(options.outputDirectory),
    ...(options.validationApi === undefined
      ? {}
      : { validationApi: options.validationApi }),
  });
}

async function readMetadata(path: string): Promise<Record<string, unknown>> {
  const metadata: Record<string, unknown> = {};
  const stream = composeStreams(
    createReadStream(path),
    parser.asStream(),
    ignore.asStream({ filter: "entries" }),
    streamObject.asStream(),
  );
  for await (const item of stream) {
    const { key, value } = item as { key: string; value: unknown };
    metadata[key] = value;
  }
  if (
    Object.keys(metadata).sort().join(",") !==
    "lastUpdated,license,source,version"
  )
    throw new Error("CropGraph calendar metadata fields changed");
  return metadata;
}

function validateCohort(cohort: Cohort, calendarSha256: string): void {
  if (
    cohort.sourceReleaseId !== releaseId ||
    cohort.calendarSha256 !== calendarSha256 ||
    !cohort.rationale
  )
    throw new Error("CropGraph cohort source pin or rationale is invalid");
  if (
    !isArray(cohort.include) ||
    !isArray(cohort.exclude) ||
    cohort.include.some((item) => typeof item !== "string") ||
    cohort.exclude.some(
      (item) =>
        !isObject(item) ||
        typeof item.slug !== "string" ||
        typeof item.reason !== "string" ||
        !item.reason,
    )
  )
    throw new Error("CropGraph cohort decisions are malformed");
  const all = [...cohort.include, ...cohort.exclude.map((item) => item.slug)];
  if (
    new Set(all).size !== all.length ||
    !sorted(cohort.include) ||
    !sorted(cohort.exclude.map((item) => item.slug))
  )
    throw new Error("CropGraph cohort decisions are duplicated or unsorted");
  const expected = digest(
    Buffer.from(
      serializeCanonicalJson({
        sourceReleaseId: cohort.sourceReleaseId,
        calendarSha256: cohort.calendarSha256,
        rationale: cohort.rationale,
        include: cohort.include,
        exclude: cohort.exclude,
      }),
    ),
  );
  if (cohort.fingerprint !== expected)
    throw new Error(
      "CropGraph cohort fingerprint does not match its decisions",
    );
}

function sorted(values: readonly string[]): boolean {
  return values.every(
    (value, index) => index === 0 || values[index - 1]! < value,
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function composeStreams(...streams: unknown[]): AsyncIterable<unknown> {
  // Node 24 exposes compose; the pinned @types/node release omits its declaration.
  const runtime = nodeStream as typeof nodeStream & {
    compose: (...stages: unknown[]) => AsyncIterable<unknown>;
  };
  return runtime.compose(...streams);
}

function rangeReversed(value: unknown): boolean {
  return (
    isObject(value) &&
    typeof value.min === "number" &&
    typeof value.max === "number" &&
    value.min > value.max
  );
}

function validPlantNowShifts(entry: Partial<Entry>): boolean {
  const modifiers = entry.climateModifiers;
  if (!isObject(modifiers)) return false;
  for (const modifier of Object.values(modifiers)) {
    if (!isObject(modifier) || !isObject(modifier.windowShifts)) continue;
    const shift = modifier.windowShifts.plant_now;
    if (
      shift !== undefined &&
      (!Number.isInteger(shift) ||
        typeof shift !== "number" ||
        shift < -12 ||
        shift > 12)
    )
      return false;
  }
  return true;
}

function digest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
