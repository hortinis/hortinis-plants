import { createHash } from "node:crypto";
import { resolve } from "node:path";
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
import { runImporter } from "../../importer/runner.js";
import type { ImportEvent, ImporterDefinition } from "../../importer/types.js";
import type { ValidationApi } from "../../schema/validation-api.js";

export interface GrowImportOptions {
  readonly inputDirectory: string;
  readonly outputDirectory: string;
  readonly validationApi?: ValidationApi;
}

export interface GrowImportResult {
  readonly extraction: GrowExtraction;
  readonly resources: readonly GrowSourceResource[];
  readonly outputHashes: Readonly<Record<string, string>>;
  readonly counts: {
    readonly assertions: number;
    readonly warnings: number;
    readonly rejectedRecords: number;
    readonly unresolvedMappings: number;
  };
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
  let extraction: GrowExtraction | undefined;
  const importer: ImporterDefinition = {
    name: "grow-edible-plant-database",
    version: "0.2.0",
    configuration: {
      expectedPlantCount: 140,
      expectedCalendarSheetCount: 12,
      temperatureUnit: "Cel",
      temperaturePolicy: "grow-temperature-celsius-v1",
      calendarCarrierYear: 2017,
      calendarDateTimezone: "UTC",
      imageFieldsExcluded: ["Image_product", "image_plant"],
    },
    inputs: EXPECTED_PACKAGE_RESOURCES.map((resource) => ({
      locator: resource.path,
      path: resource.path,
      role: resource.role,
      ...(resource.role === "derived"
        ? {
            sha256: resource.sha256,
            derivedFrom: "plant1.accdb",
            preparation: {
              tool: "mdbtools",
              version: "1.0.1",
              command: "mdb-export plant1.accdb 'Edible plants'",
            },
          }
        : {}),
    })),
    outputs: [
      {
        name: "source-records",
        path: "source-records.jsonl",
        role: "auxiliary",
        mediaType: "application/jsonl",
      },
      {
        name: "locations",
        path: "locations.jsonl",
        role: "auxiliary",
        mediaType: "application/jsonl",
      },
      {
        name: "calendar-windows",
        path: "calendar-windows.jsonl",
        role: "auxiliary",
        mediaType: "application/jsonl",
      },
      {
        name: "candidates",
        path: "candidates.jsonl",
        role: "auxiliary",
        mediaType: "application/jsonl",
      },
      {
        name: "diagnostics",
        path: "diagnostics.jsonl",
        role: "diagnostics",
        mediaType: "application/jsonl",
        schemaId: "urn:hortinis:plants:schema:v1:import-diagnostic",
      },
      {
        name: "attribution-candidate",
        path: "attribution-candidate.jsonl",
        role: "auxiliary",
        mediaType: "application/jsonl",
      },
    ],
    tools: { csvParse: "6.2.1", exceljs: "4.4.0", mdbtools: "1.0.1" },
    async *run(context): AsyncIterable<ImportEvent> {
      const source = context.sourceManifest as {
        id?: unknown;
        release?: { identifier?: unknown };
        licenceReview?: { declaredLicence?: unknown; status?: unknown };
        profileEligibility?: readonly {
          profile?: unknown;
          decision?: unknown;
        }[];
      };
      if (
        source.id !== GROW_SOURCE_MANIFEST_ID ||
        source.release?.identifier !== sourceReleaseId ||
        source.licenceReview?.declaredLicence !== "CC-BY-4.0" ||
        source.licenceReview.status !== "accepted" ||
        !source.profileEligibility?.some(
          (item) =>
            item.profile === "commercial" && item.decision === "eligible",
        )
      ) {
        throw new Error(
          "GROW source manifest identity or commercial licence eligibility does not match the adapter contract",
        );
      }
      const plantCsv = await readPlantCsv(
        context.resourcePath("export/edible-plants.csv"),
      );
      const calendar = await readCalendar(
        context.resourcePath("PlantingCalendar.xlsx"),
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
      extraction = {
        plants: plantCsv.plants,
        locations: calendar.locations,
        calendarWindows: calendar.windows,
        candidates,
        diagnostics: sortDiagnostics(diagnostics),
      };
      const fatalCodes = new Set([
        "SOURCE_RECORD_COUNT_CHANGED",
        "SOURCE_ID_FINGERPRINT_CHANGED",
        "CALENDAR_ID_SET_MISMATCH",
      ]);
      const fatal = extraction.diagnostics.find((diagnostic) =>
        fatalCodes.has(diagnostic.code),
      );
      if (fatal !== undefined)
        throw new Error(
          `GROW source invariant failed (${fatal.code}): ${fatal.message}`,
        );

      for (const value of extraction.plants)
        yield {
          output: "source-records",
          value: {
            sourceRecordKey: {
              source: {
                sourceId: GROW_SOURCE_ID,
                sourceManifestId,
                sourceReleaseId,
              },
              recordId: value.sourceRecordId,
            },
            sourceLocator: value.sourceLocator,
            fields: value.fields,
          },
        };
      for (const value of extraction.locations)
        yield { output: "locations", value };
      for (const value of extraction.calendarWindows)
        yield { output: "calendar-windows", value };
      for (const value of extraction.candidates)
        yield { output: "candidates", value };
      for (const diagnostic of extraction.diagnostics) {
        yield { output: "diagnostics", value: toImportDiagnostic(diagnostic) };
      }
      yield {
        output: "attribution-candidate",
        value: {
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
        },
      };
    },
  };
  const run = await runImporter({
    importer,
    sourceManifestPath,
    resourceDirectory: inputDirectory,
    outputDirectory,
    ...(options.validationApi === undefined
      ? {}
      : { validationApi: options.validationApi }),
  });
  if (extraction === undefined)
    throw new Error("GROW importer completed without extraction");
  const manifest = run.manifest as {
    inputs: readonly Record<string, unknown>[];
    outputs: readonly { path: string; sha256: string }[];
    counts: GrowImportResult["counts"];
  };
  const resources = manifest.inputs.map((input) => ({
    path: String(input.locator),
    sha256: String(input.sha256),
    mediaType:
      EXPECTED_PACKAGE_RESOURCES.find(
        (resource) => resource.path === input.locator,
      )?.mediaType ?? "application/octet-stream",
    role: input.role as "upstream" | "derived",
  }));
  const outputHashes = Object.fromEntries(
    manifest.outputs.map((output) => [output.path, output.sha256]),
  );
  outputHashes["importer-run-manifest.json"] = run.manifestSha256;
  return { extraction, resources, outputHashes, counts: manifest.counts };
}

function toImportDiagnostic(
  diagnostic: GrowDiagnostic,
): Record<string, unknown> {
  const kind =
    diagnostic.code.startsWith("UNMAPPED_") ||
    diagnostic.code === "AMBIGUOUS_OUTDOOR_OPERATION" ||
    diagnostic.code === "UNRESOLVED_HARVEST_DURATION_ANCHOR"
      ? "unresolved-mapping"
      : diagnostic.severity === "error"
        ? "rejected-record"
        : "warning";
  return {
    kind,
    code: diagnostic.code,
    message: diagnostic.message,
    ...(diagnostic.sourceRecordId === undefined
      ? {}
      : {
          sourceRecordKey: {
            source: {
              sourceId: GROW_SOURCE_ID,
              sourceManifestId,
              sourceReleaseId,
            },
            recordId: diagnostic.sourceRecordId,
          },
          sourceRecordId: diagnostic.sourceRecordId,
        }),
    ...(diagnostic.sourceLocator === undefined
      ? {}
      : { sourceLocator: diagnostic.sourceLocator }),
    ...(diagnostic.originalValue === undefined
      ? {}
      : { originalValue: diagnostic.originalValue }),
    ...(diagnostic.field === undefined
      ? {}
      : { details: { field: diagnostic.field } }),
  };
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
        sourceRecordKey: {
          source: {
            sourceId: GROW_SOURCE_ID,
            sourceManifestId,
            sourceReleaseId,
          },
          recordId: plant.sourceRecordId,
        },
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
      sourceRecordKey: {
        source: {
          sourceId: GROW_SOURCE_ID,
          sourceManifestId,
          sourceReleaseId,
        },
        recordId: window.sourceRecordId,
      },
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
