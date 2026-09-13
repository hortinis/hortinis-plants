import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Readable, Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import {
  GROW_LICENCE_ID,
  GROW_SOURCE_ID,
  GROW_SOURCE_MANIFEST_ID,
  GROW_SOURCE_RELEASE_ID,
  EXPECTED_MISSING_PLANT_IDS,
  EXPECTED_PACKAGE_RESOURCES,
} from "./constants.js";
import { readCalendar } from "./read-calendar.js";
import { readPlantCsv } from "./read-plant-csv.js";
import {
  parseDuration,
  parsePh,
  parseTemperature,
  scalarText,
} from "./parse-values.js";
import type {
  GrowCandidate,
  GrowDiagnostic,
  GrowExtraction,
  GrowPlantRecord,
  GrowSourceResource,
} from "./types.js";
import { serializeCanonicalJson } from "../../serialization/canonical-json.js";
import { writeJsonLines } from "../../serialization/json-lines.js";

export interface GrowImportOptions {
  readonly inputDirectory: string;
  readonly outputDirectory: string;
  readonly verifyChecksums?: boolean;
}

export interface GrowImportResult {
  readonly extraction: GrowExtraction;
  readonly resources: readonly GrowSourceResource[];
  readonly outputHashes: Readonly<Record<string, string>>;
}

const sourceManifestId = GROW_SOURCE_MANIFEST_ID;
const sourceReleaseId = GROW_SOURCE_RELEASE_ID;

export async function importGrowSource(
  options: GrowImportOptions,
): Promise<GrowImportResult> {
  const inputDirectory = resolve(options.inputDirectory);
  const outputDirectory = resolve(options.outputDirectory);
  const sourceManifestPath = fileURLToPath(
    new URL("../../../data/sources/grow/source-manifest.json", import.meta.url),
  );
  const sourceManifestBytes = await readFile(sourceManifestPath);
  const sourceManifest = JSON.parse(sourceManifestBytes.toString("utf8")) as {
    id?: unknown;
    release?: { identifier?: unknown };
    licenceReview?: { declaredLicence?: unknown; status?: unknown };
  };
  if (
    sourceManifest.id !== sourceManifestId ||
    sourceManifest.release?.identifier !== sourceReleaseId ||
    sourceManifest.licenceReview?.declaredLicence !== "CC-BY-4.0" ||
    sourceManifest.licenceReview?.status !== "accepted"
  ) {
    throw new Error(
      "GROW source manifest identity or accepted licence does not match the adapter contract",
    );
  }
  const sourceManifestSha256 = createHash("sha256")
    .update(sourceManifestBytes)
    .digest("hex");
  const resources = await verifyResources(
    inputDirectory,
    options.verifyChecksums !== false,
  );
  const plantCsv = await readPlantCsv(
    join(inputDirectory, "export/edible-plants.csv"),
  );
  const calendar = await readCalendar(
    join(inputDirectory, "PlantingCalendar.xlsx"),
  );
  const diagnostics: GrowDiagnostic[] = [
    ...plantCsv.diagnostics,
    ...calendar.diagnostics,
  ];
  for (const plant of plantCsv.plants) {
    diagnostics.push({
      code: "UNMAPPED_SUBJECT",
      severity: "warning",
      message:
        "No reviewed GROW source ID to catalog subject mapping is configured; this record remains a source record and candidate only.",
      sourceRecordId: plant.sourceRecordId,
      sourceLocator: plant.sourceLocator,
    });
  }
  for (const location of calendar.locations) {
    diagnostics.push({
      code: "UNMAPPED_GEOGRAPHIC_CONTEXT",
      severity: "warning",
      message:
        "GROW location and strata are retained as source applicability; no Hortinis geographic context mapping is configured.",
      sourceLocator: `PlantingCalendar.xlsx!${location.sheetCode}`,
      originalValue: location,
    });
  }
  validatePlantFingerprint(plantCsv.plants, diagnostics);
  validateCalendarIds(plantCsv.plants, calendar.idsBySheet, diagnostics);
  compareSourceNames(plantCsv.plants, calendar.plantNamesById, diagnostics);
  const candidates = buildCandidates(
    plantCsv.plants,
    calendar.windows,
    diagnostics,
  );
  const extraction: GrowExtraction = {
    plants: plantCsv.plants,
    locations: calendar.locations,
    calendarWindows: calendar.windows,
    candidates,
    diagnostics: sortDiagnostics(diagnostics),
  };
  const outputHashes = await writeOutputs(
    outputDirectory,
    extraction,
    resources,
    sourceManifestSha256,
    options.verifyChecksums !== false,
  );
  return { extraction, resources, outputHashes };
}

async function verifyResources(
  inputDirectory: string,
  verifyChecksums: boolean,
): Promise<GrowSourceResource[]> {
  const resources: GrowSourceResource[] = [];
  for (const resource of EXPECTED_PACKAGE_RESOURCES) {
    const path = join(inputDirectory, resource.path);
    const bytes = await readFile(path);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (verifyChecksums && sha256 !== resource.sha256) {
      throw new Error(
        `SHA-256 mismatch for GROW source resource ${resource.path}`,
      );
    }
    resources.push({ ...resource, sha256 });
  }
  return resources;
}

function validatePlantFingerprint(
  plants: readonly GrowPlantRecord[],
  diagnostics: GrowDiagnostic[],
): void {
  if (plants.length !== 140) {
    diagnostics.push({
      code: "SOURCE_RECORD_COUNT_CHANGED",
      severity: "error",
      message: `Pinned GROW resource contains ${plants.length} plant records; expected 140.`,
    });
  }
  const actual = new Set(plants.map((plant) => Number(plant.sourceRecordId)));
  const missingIds = Array.from({ length: 146 }, (_, index) => index + 1)
    .filter(
      (id) =>
        !EXPECTED_MISSING_PLANT_IDS.includes(
          id as (typeof EXPECTED_MISSING_PLANT_IDS)[number],
        ),
    )
    .filter((id) => !actual.has(id));
  const expectedPresent = Array.from(
    { length: 146 },
    (_, index) => index + 1,
  ).filter(
    (id) =>
      !EXPECTED_MISSING_PLANT_IDS.includes(
        id as (typeof EXPECTED_MISSING_PLANT_IDS)[number],
      ),
  );
  const unexpected = [...actual]
    .filter((id) => !expectedPresent.includes(id))
    .sort((a, b) => a - b);
  if (missingIds.length > 0 || unexpected.length > 0) {
    diagnostics.push({
      code: "SOURCE_ID_FINGERPRINT_CHANGED",
      severity: "error",
      message:
        "Plant IDs do not match the pinned 140-record GROW release fingerprint.",
      originalValue: { missingIds, unexpectedIds: unexpected },
    });
  }
  diagnostics.push({
    code: "SOURCE_DOCUMENTATION_COUNT_MISMATCH",
    severity: "warning",
    message:
      "GROW documentation says 146 species; the pinned Access/CSV resource contains 140 records.",
    originalValue: { documentedCount: 146, actualCount: plants.length },
  });
}

function validateCalendarIds(
  plants: readonly GrowPlantRecord[],
  idsBySheet: Readonly<Record<string, readonly string[]>>,
  diagnostics: GrowDiagnostic[],
): void {
  const expected = plants
    .map((plant) => plant.sourceRecordId)
    .sort((a, b) => Number(a) - Number(b));
  for (const [sheetCode, ids] of Object.entries(idsBySheet)) {
    if (
      ids.length !== expected.length ||
      ids.some((id, index) => id !== expected[index])
    ) {
      diagnostics.push({
        code: "CALENDAR_ID_SET_MISMATCH",
        severity: "error",
        message: `Calendar sheet ${sheetCode} does not contain the same plant IDs as the Access table.`,
        sourceLocator: `PlantingCalendar.xlsx!${sheetCode}`,
        originalValue: {
          expectedCount: expected.length,
          actualCount: ids.length,
        },
      });
    }
  }
}

function compareSourceNames(
  plants: readonly GrowPlantRecord[],
  calendarNames: ReadonlyMap<
    string,
    { scientificName: string; commonName: string }
  >,
  diagnostics: GrowDiagnostic[],
): void {
  for (const plant of plants) {
    const names = calendarNames.get(plant.sourceRecordId);
    if (names === undefined) continue;
    const scientificName = scalarText(plant.fields["Full taxonomic name"]);
    const commonName = scalarText(plant.fields["Common name"]);
    if (
      scientificName !== names.scientificName ||
      commonName !== names.commonName
    ) {
      diagnostics.push({
        code: "SOURCE_NAME_DRIFT",
        severity: "warning",
        message:
          "Calendar and Access names differ for this source ID; the ID remains the join key.",
        sourceRecordId: plant.sourceRecordId,
        sourceLocator: `${plant.sourceLocator}&field=Full%20taxonomic%20name`,
        originalValue: {
          database: { scientificName, commonName },
          calendar: names,
        },
      });
    }
  }
}

function buildCandidates(
  plants: readonly GrowPlantRecord[],
  calendarWindows: GrowExtraction["calendarWindows"],
  diagnostics: GrowDiagnostic[],
): GrowCandidate[] {
  const candidates: GrowCandidate[] = [];
  for (const plant of plants) {
    const fields = plant.fields;
    const candidate = (
      predicate: string,
      field: string,
      rawValue: unknown,
      normalizedValue: unknown,
      applicability: Record<string, unknown> = {
        geographicScope: "Europe, source scope",
      },
    ) => {
      const locator = `${plant.sourceLocator}&field=${encodeURIComponent(field)}`;
      candidates.push({
        id: stableId("candidate", `${locator}|${predicate}`),
        sourceId: GROW_SOURCE_ID,
        sourceManifestId,
        sourceReleaseId,
        sourceRecordId: plant.sourceRecordId,
        sourceLocator: locator,
        licenceId: GROW_LICENCE_ID,
        licenceDecision: "eligible",
        predicate,
        rawValue,
        normalizedValue,
        applicability,
        reviewStatus: "unreviewed",
      });
    };

    const ph = parsePh(
      fields["Preferred pH"],
      `${plant.sourceLocator}&field=Preferred%20pH`,
    );
    if (ph.value !== undefined)
      candidate(
        "soil_ph_range",
        "Preferred pH",
        fields["Preferred pH"],
        ph.value,
      );
    if (ph.diagnostic !== undefined)
      diagnostics.push({
        ...ph.diagnostic,
        sourceRecordId: plant.sourceRecordId,
        field: "Preferred pH",
      });

    const sun = normalizeSun(fields["Sunlight requirements"]);
    if (sun !== undefined)
      candidate(
        "sun_requirement",
        "Sunlight requirements",
        fields["Sunlight requirements"],
        sun,
      );

    const water = normalizeOrdinal(fields["Water Requirements"]);
    if (water !== undefined)
      candidate(
        "water_requirement",
        "Water Requirements",
        fields["Water Requirements"],
        water,
      );

    const optimumRaw = fields["Optimum Germination Temerature"];
    const optimum = parseTemperature(optimumRaw, {
      locator: `${plant.sourceLocator}&field=Optimum%20Germination%20Temerature`,
    });
    const germinationDuration = parseDuration(
      fields["Days to germination at optimum temperature"],
      `${plant.sourceLocator}&field=Days%20to%20germination%20at%20optimum%20temperature`,
    );
    if (optimum.diagnostic !== undefined)
      diagnostics.push({
        ...optimum.diagnostic,
        sourceRecordId: plant.sourceRecordId,
        field: "Optimum Germination Temerature",
      });
    if (germinationDuration.diagnostic !== undefined)
      diagnostics.push({
        ...germinationDuration.diagnostic,
        sourceRecordId: plant.sourceRecordId,
        field: "Days to germination at optimum temperature",
      });
    if (
      optimum.value !== undefined ||
      germinationDuration.value !== undefined
    ) {
      const normalizedValue: Record<string, unknown> = {};
      if (optimum.value !== undefined)
        normalizedValue.temperature = optimum.value;
      if (germinationDuration.value !== undefined)
        normalizedValue.duration = germinationDuration.value;
      candidate(
        "germination_profile",
        "Optimum Germination Temerature",
        {
          temperature: optimumRaw,
          daysToGermination:
            fields["Days to germination at optimum temperature"],
        },
        normalizedValue,
        {
          geographicScope: "Europe, source scope",
          temperatureUnit: "Cel",
          temperatureInterpretation: "reported optimum or optimum band",
        },
      );
    }

    const growingRaw = fields["Plant growing ideal temperature"];
    const growingTemperature = parseTemperature(growingRaw, {
      locator: `${plant.sourceLocator}&field=Plant%20growing%20ideal%20temperature`,
    });
    if (growingTemperature.value !== undefined) {
      candidate(
        "growing_temperature",
        "Plant growing ideal temperature",
        growingRaw,
        growingTemperature.value,
        {
          geographicScope: "Europe, source scope",
          temperatureUnit: "Cel",
          temperatureInterpretation:
            "reported ideal band; boundaries are not lethal limits",
        },
      );
    }
    if (growingTemperature.diagnostic !== undefined)
      diagnostics.push({
        ...growingTemperature.diagnostic,
        sourceRecordId: plant.sourceRecordId,
        field: "Plant growing ideal temperature",
      });

    const harvestRaw = fields["Length of gorwing to harvest"];
    const harvestDuration = parseDuration(
      harvestRaw,
      `${plant.sourceLocator}&field=Length%20of%20gorwing%20to%20harvest`,
    );
    if (harvestDuration.value !== undefined) {
      diagnostics.push({
        code: "UNRESOLVED_HARVEST_DURATION_ANCHOR",
        severity: "warning",
        message:
          "GROW supplies a duration to harvest but does not define the event from which the days are counted.",
        sourceRecordId: plant.sourceRecordId,
        sourceLocator: `${plant.sourceLocator}&field=Length%20of%20gorwing%20to%20harvest`,
        originalValue: harvestRaw,
      });
      candidate(
        "days_to_first_harvest",
        "Length of gorwing to harvest",
        harvestRaw,
        {
          duration: harvestDuration.value,
          anchor: "unspecified-in-source",
        },
      );
    }
    if (harvestDuration.diagnostic !== undefined)
      diagnostics.push({
        ...harvestDuration.diagnostic,
        sourceRecordId: plant.sourceRecordId,
        field: "Length of gorwing to harvest",
      });

    const lifecycle = normalizeLifecycle(fields["Descriptive Growing Season"]);
    if (lifecycle !== undefined)
      candidate(
        "life_cycle",
        "Descriptive Growing Season",
        fields["Descriptive Growing Season"],
        lifecycle,
      );
    const classValue = normalizeTemperatureClass(fields["Temperature class"]);
    if (classValue !== undefined)
      candidate(
        "temperature_class",
        "Temperature class",
        fields["Temperature class"],
        classValue,
      );
  }

  for (const window of calendarWindows) {
    const normalizedValue = {
      type: "calendar-date-window",
      start: window.start,
      end: window.end,
      precision: window.precision,
      season: window.season,
      action: window.operation,
      crossesYearBoundary: window.crossesYearBoundary,
    };
    candidates.push({
      id: stableId("candidate", `${window.sourceLocator}|calendar_window`),
      sourceId: GROW_SOURCE_ID,
      sourceManifestId,
      sourceReleaseId,
      sourceRecordId: window.sourceRecordId,
      sourceLocator: window.sourceLocator,
      licenceId: GROW_LICENCE_ID,
      licenceDecision: "eligible",
      predicate: "calendar_window",
      rawValue: { start: window.start, end: window.end, carrierYear: 2017 },
      normalizedValue,
      applicability: {
        geography: {
          type: "source-location",
          sheetCode: window.location.sheetCode,
          name: window.location.name,
          country: window.location.country,
          latitude: window.location.latitude,
          longitude: window.location.longitude,
          strataCodes: window.location.strataCodes,
        },
        growingSystem:
          window.operation === "indoors_or_undercover" ? "unknown" : "outdoor",
        propagation: "unknown",
      },
      reviewStatus: "unreviewed",
    });
  }
  candidates.sort((a, b) => a.id.localeCompare(b.id));
  return candidates;
}

function normalizeSun(input: unknown): string[] | undefined {
  const raw = scalarText(input).toLocaleLowerCase("en");
  if (raw.length === 0) return undefined;
  const values = new Set<string>();
  if (raw.includes("full sun")) values.add("full_sun");
  if (raw.includes("partial shade")) values.add("partial_shade");
  if (raw.includes("full shade")) values.add("full_shade");
  return values.size === 0 ? undefined : [...values].sort();
}

function normalizeOrdinal(input: unknown): string | undefined {
  const key = scalarText(input).toLocaleLowerCase("en").replace(/\s+/gu, " ");
  const values: Readonly<Record<string, string>> = {
    "very low": "very_low",
    low: "low",
    medium: "medium",
    high: "high",
    "very high": "very_high",
  };
  return values[key];
}

function normalizeLifecycle(input: unknown): string | undefined {
  const key = scalarText(input).toLocaleLowerCase("en").replace(/\s+/gu, " ");
  if (["annual"].includes(key)) return "annual";
  if (["biennial"].includes(key)) return "biennial";
  if (["perennial", "perrenial"].includes(key)) return "perennial";
  if (key.includes("biennial") && key.includes("annual"))
    return "biennial-grown-as-annual";
  return undefined;
}

function normalizeTemperatureClass(input: unknown): string | undefined {
  const key = scalarText(input).toLocaleLowerCase("en").replaceAll(" ", "_");
  const allowed = new Set([
    "very_hardy",
    "hardy",
    "half_hardy",
    "tender",
    "very_tender",
  ]);
  if (key === "very_hard") return "very_hardy";
  return allowed.has(key) ? key : undefined;
}

function stableId(prefix: string, input: string): string {
  const hash = createHash("sha256").update(input).digest("hex").slice(0, 24);
  return `${prefix}_${hash}`;
}

function sortDiagnostics(
  diagnostics: readonly GrowDiagnostic[],
): GrowDiagnostic[] {
  return [...diagnostics].sort((a, b) =>
    [a.code, a.sourceRecordId ?? "", a.sourceLocator ?? "", a.field ?? ""]
      .join("\u0000")
      .localeCompare(
        [
          b.code,
          b.sourceRecordId ?? "",
          b.sourceLocator ?? "",
          b.field ?? "",
        ].join("\u0000"),
      ),
  );
}

async function writeOutputs(
  outputDirectory: string,
  extraction: GrowExtraction,
  resources: readonly GrowSourceResource[],
  sourceManifestSha256: string,
  verifyChecksums: boolean,
): Promise<Record<string, string>> {
  await mkdir(outputDirectory, { recursive: true });
  const generatedFiles = [
    "source-records.jsonl",
    "locations.jsonl",
    "calendar-windows.jsonl",
    "candidates.jsonl",
    "diagnostics.jsonl",
    "attribution-candidate.json",
    "importer-run-manifest.json",
    "attributions.json",
  ];
  await Promise.all(
    generatedFiles.map(async (filename) => {
      try {
        await unlink(join(outputDirectory, filename));
      } catch (error) {
        if (!isNodeError(error) || error.code !== "ENOENT") throw error;
      }
    }),
  );
  const diagnosticsByCode = Object.fromEntries(
    [...new Set(extraction.diagnostics.map((item) => item.code))]
      .sort()
      .map((code) => [
        code,
        extraction.diagnostics.filter((item) => item.code === code).length,
      ]),
  );
  const manifestResources = resources;
  const outputs: Record<string, unknown[]> = {
    "source-records.jsonl": [...extraction.plants],
    "locations.jsonl": [...extraction.locations],
    "calendar-windows.jsonl": [...extraction.calendarWindows],
    "candidates.jsonl": [...extraction.candidates],
    "diagnostics.jsonl": [...extraction.diagnostics],
  };
  const outputHashes: Record<string, string> = {};
  const outputEntries: { path: string; sha256: string; entryCount: number }[] =
    [];
  for (const [filename, rows] of Object.entries(outputs)) {
    const sha256 = await writeJsonlFile(join(outputDirectory, filename), rows);
    outputHashes[filename] = sha256;
    outputEntries.push({ path: filename, sha256, entryCount: rows.length });
  }
  const attributionCandidate = {
    stage: "import-candidates",
    sourceId: GROW_SOURCE_ID,
    sourceReleaseId,
    sourceLocator:
      "https://discovery.dundee.ac.uk/en/datasets/edible-plant-database/",
    licenceExpression: "CC-BY-4.0",
    requiredNotice:
      "Edible Plant Database, University of Dundee, DOI 10.15132/10000157, licensed under CC BY 4.0. Adapted by Hortinis. Images excluded.",
    candidateRecordIds: extraction.candidates
      .map((candidate) => candidate.id)
      .sort(),
  };
  const attributionBytes = Buffer.concat([
    Buffer.from(serializeCanonicalJson(attributionCandidate)),
    Buffer.from("\n"),
  ]);
  await writeFile(
    join(outputDirectory, "attribution-candidate.json"),
    attributionBytes,
  );
  const attributionHash = createHash("sha256")
    .update(attributionBytes)
    .digest("hex");
  outputHashes["attribution-candidate.json"] = attributionHash;
  outputEntries.push({
    path: "attribution-candidate.json",
    sha256: attributionHash,
    entryCount: 1,
  });
  const configuration = {
    expectedPlantCount: 140,
    expectedCalendarSheetCount: 12,
    verifyChecksums,
    temperatureUnit: "Cel",
    temperaturePolicy: "grow-temperature-celsius-v1",
    calendarCarrierYear: 2017,
    calendarDateTimezone: "UTC",
    imageFieldsExcluded: ["Image_product", "image_plant"],
  };
  const configurationBytes = serializeCanonicalJson(configuration);
  const manifest = {
    schemaVersion: "1.0.0",
    importer: { name: "grow-edible-plant-database", version: "0.1.0" },
    sourceManifest: {
      id: sourceManifestId,
      sha256: sourceManifestSha256,
    },
    sourceReleaseId,
    configuration,
    configurationSha256: createHash("sha256")
      .update(configurationBytes)
      .digest("hex"),
    tools: {
      node: process.version,
      csvParse: "6.2.1",
      exceljs: "4.4.0",
      mdbtools: "1.0.1 (CSV prepared before importer run)",
    },
    sourceResources: manifestResources,
    outputs: outputEntries,
    counts: {
      plantRecords: extraction.plants.length,
      locations: extraction.locations.length,
      validCalendarWindows: extraction.calendarWindows.length,
      candidates: extraction.candidates.length,
      diagnostics: extraction.diagnostics.length,
      excludedFields: ["Image_product", "image_plant"],
    },
    preparation: {
      derivedResource: "export/edible-plants.csv",
      tool: "mdbtools v1.0.1",
      command: "mdb-export plant1.accdb 'Edible plants'",
      sourceTable: "Edible plants",
    },
    diagnosticCounts: diagnosticsByCode,
    diagnosticSummary: {
      errors: extraction.diagnostics.filter((item) => item.severity === "error")
        .length,
      warnings: extraction.diagnostics.filter(
        (item) => item.severity === "warning",
      ).length,
      info: extraction.diagnostics.filter((item) => item.severity === "info")
        .length,
    },
    normalization: {
      temperatureUnit: "Cel",
      temperaturePolicy: "grow-temperature-celsius-v1",
      calendarCarrierYear: 2017,
    },
  };
  const manifestBytes = Buffer.concat([
    Buffer.from(serializeCanonicalJson(manifest)),
    Buffer.from("\n"),
  ]);
  await writeFile(
    join(outputDirectory, "importer-run-manifest.json"),
    manifestBytes,
  );
  outputHashes["importer-run-manifest.json"] = createHash("sha256")
    .update(manifestBytes)
    .digest("hex");
  return outputHashes;
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}

async function writeJsonlFile(
  path: string,
  rows: readonly unknown[],
): Promise<string> {
  const hash = createHash("sha256");
  const meter = new Transform({
    transform(
      chunk: Buffer,
      _encoding: BufferEncoding,
      callback: TransformCallback,
    ) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(
    Readable.from(writeJsonLines(rows)),
    meter,
    createWriteStream(path),
  );
  return hash.digest("hex");
}
