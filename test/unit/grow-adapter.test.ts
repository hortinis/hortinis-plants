import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { importGrowSource } from "../../src/adapters/grow/adapter.js";
import {
  EXPECTED_LOCATION_SHEETS,
  EXPECTED_PLANT_FIELDS,
} from "../../src/adapters/grow/constants.js";
import {
  isValidGerminationProfile,
  isValidTemperatureProfile,
  parseDuration,
  parsePh,
  parseTemperature,
} from "../../src/adapters/grow/parse-values.js";
import { readCalendar } from "../../src/adapters/grow/read-calendar.js";
import { readPlantCsv } from "../../src/adapters/grow/read-plant-csv.js";

describe("GROW value normalization", () => {
  it("converts scalar optima and ranges to Celsius profiles without inventing values", () => {
    expect(parseTemperature("24", { locator: "f1" }).value).toEqual({
      unit: "Cel",
      optimum: 24,
    });
    expect(parseTemperature("18 – 26", { locator: "f2" }).value).toEqual({
      unit: "Cel",
      minimum: 18,
      maximum: 26,
    });
    expect(parseTemperature("18-", { locator: "f3" }).value).toBeUndefined();
    expect(
      parseTemperature("Not applicable.", { locator: "f4" }).value,
    ).toBeUndefined();
    expect(parseTemperature("28-18", { locator: "f5" }).diagnostic?.code).toBe(
      "INVALID_TEMPERATURE",
    );
  });

  it("normalizes numeric ranges and validates temperature and germination semantics", () => {
    expect(parsePh("5.5–6.5", "ph").value).toEqual({
      minimum: 5.5,
      maximum: 6.5,
    });
    expect(parseDuration("4-10", "duration").value).toEqual({
      unit: "d",
      minimum: 4,
      maximum: 10,
    });
    expect(
      isValidTemperatureProfile({
        unit: "Cel",
        minimum: 10,
        maximum: 30,
        optimum: 24,
      }),
    ).toBe(true);
    expect(
      isValidTemperatureProfile({ unit: "Cel", minimum: 30, maximum: 10 }),
    ).toBe(false);
    expect(
      isValidTemperatureProfile({
        unit: "Cel",
        minimum: 10,
        maximum: 20,
        optimum: 24,
      }),
    ).toBe(false);
    expect(
      isValidGerminationProfile({
        temperature: { unit: "Cel", optimum: 24 },
        duration: { unit: "d", minimum: 4, maximum: 10 },
      }),
    ).toBe(true);
    expect(isValidGerminationProfile({})).toBe(false);
  });
});

describe("GROW package readers", () => {
  it("streams CSV records with quoted embedded newlines and preserves source fields", async () => {
    const directory = await mkdtemp(join(tmpdir(), "grow-csv-"));
    try {
      const headers = [...EXPECTED_PLANT_FIELDS];
      const values = headers.map((header) =>
        header === "ID"
          ? "19"
          : header === "General Description"
            ? "Line 1\nLine 2"
            : "",
      );
      const csv = `${headers.join(",")}\n${values.map(quoteCsv).join(",")}\n`;
      const path = join(directory, "plants.csv");
      await writeFile(path, csv);
      const result = await readPlantCsv(path);
      expect(result.plants).toHaveLength(1);
      expect(result.plants[0]?.fields["General Description"]).toBe(
        "Line 1\nLine 2",
      );
      expect(result.plants[0]?.sourceRecordId).toBe("19");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("extracts day windows and location coordinates from the workbook", async () => {
    const directory = await mkdtemp(join(tmpdir(), "grow-xlsx-"));
    try {
      const path = join(directory, "calendar.xlsx");
      await createCalendarFixture(path, { malformed: false });
      const result = await readCalendar(path);
      expect(result.locations).toHaveLength(12);
      expect(result.locations[0]).toMatchObject({
        sheetCode: "MDS",
        latitude: 37.4215,
        longitude: -6.0147,
      });
      expect(result.windows).toHaveLength(108);
      expect(
        result.windows.find(
          (item) => item.operation === "indoors_or_undercover",
        ),
      ).toMatchObject({
        start: { month: 12, day: 15 },
        end: { month: 1, day: 30 },
        crossesYearBoundary: true,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects the pinned-source malformed calendar window instead of repairing it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "grow-xlsx-invalid-"));
    try {
      const path = join(directory, "calendar.xlsx");
      await createCalendarFixture(path, { malformed: true });
      const result = await readCalendar(path);
      expect(result.windows).toHaveLength(107);
      expect(
        result.diagnostics.some(
          (item) => item.code === "INVALID_CALENDAR_WINDOW",
        ),
      ).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("pinned GROW source package", () => {
  it("produces deterministic staging files for the supplied source release", async () => {
    const inputDirectory = join(
      process.cwd(),
      "data/sources/grow/releases/2020",
    );
    const directory = await mkdtemp(join(tmpdir(), "grow-import-"));
    try {
      const result = await importGrowSource({
        inputDirectory,
        outputDirectory: directory,
      });
      expect(result.extraction.plants).toHaveLength(140);
      expect(result.extraction.locations).toHaveLength(12);
      expect(result.extraction.calendarWindows).toHaveLength(4311);
      expect(
        result.extraction.diagnostics.some((item) => item.severity === "error"),
      ).toBe(false);
      expect(
        result.extraction.diagnostics.filter(
          (item) => item.code === "INVALID_CALENDAR_WINDOW",
        ),
      ).toHaveLength(1);
      expect(
        result.extraction.candidates.filter(
          (item) => item.predicate === "germination_profile",
        ).length,
      ).toBeGreaterThan(0);
      expect(result.extraction.candidates[0]).toMatchObject({
        sourceId: "source_grow_edible_plant_database",
        sourceManifestId: "source_manifest_grow_epd_2020",
        sourceReleaseId: "doi:10.15132/10000157",
        licenceId: "licence_cc_by_4_0",
        licenceDecision: "eligible",
        reviewStatus: "unreviewed",
      });
      const manifestBefore = await readFile(
        join(directory, "importer-run-manifest.json"),
        "utf8",
      );
      const outputHashes = { ...result.outputHashes };
      for (const [filename, expectedHash] of Object.entries(outputHashes)) {
        expect(
          createHash("sha256")
            .update(await readFile(join(directory, filename)))
            .digest("hex"),
          filename,
        ).toBe(expectedHash);
      }
      const secondDirectory = join(directory, "second");
      const second = await importGrowSource({
        inputDirectory,
        outputDirectory: secondDirectory,
      });
      expect(second.outputHashes).toEqual(outputHashes);
      expect(
        await readFile(
          join(secondDirectory, "importer-run-manifest.json"),
          "utf8",
        ),
      ).toBe(manifestBefore);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30000);
});

function quoteCsv(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

async function createCalendarFixture(
  path: string,
  options: { malformed: boolean },
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const strata = workbook.addWorksheet("Strata table");
  strata.getCell("C2").value = "MDS1";
  for (const sheetCode of EXPECTED_LOCATION_SHEETS) {
    const sheet = workbook.addWorksheet(sheetCode);
    sheet.getCell("A1").value = `${sheetCode} test location`;
    sheet.getCell("C2").value = "37.4215° N, 6.0147° W";
    sheet.getCell("D7").value = "Season 1";
    sheet.getCell("D8").value = "Sow indoors / undercover";
    sheet.getCell("E8").value = "Sow indoors / undercover";
    sheet.getCell("F8").value = "Sow outdoors / plant out";
    sheet.getCell("G8").value = "Sow outdoors / plant out";
    sheet.getCell("H8").value = "Harvest";
    sheet.getCell("I8").value = "Harvest";
    sheet.getCell("A9").value = "ID";
    sheet.getCell("B9").value = "Full taxonomic name";
    sheet.getCell("C9").value = "Common name";
    for (const [column, label] of [
      ["D", "start"],
      ["E", "end"],
      ["F", "start"],
      ["G", "end"],
      ["H", "start"],
      ["I", "end"],
    ] as const) {
      sheet.getCell(`${column}9`).value = label;
    }
    for (const [index, rowNumber] of [10, 11, 12].entries()) {
      sheet.getCell(`A${rowNumber}`).value = index + 1;
      sheet.getCell(`B${rowNumber}`).value = `Species ${index + 1}`;
      sheet.getCell(`C${rowNumber}`).value = `Plant ${index + 1}`;
      for (const [column, month, day] of [
        ["D", 11, 15],
        ["E", 0, 30],
        ["F", 0, 15],
        ["G", 5, 30],
        ["H", 2, 15],
        ["I", 11, 30],
      ] as const) {
        const cell = sheet.getCell(`${column}${rowNumber}`);
        cell.value = new Date(Date.UTC(2017, month, day));
        cell.numFmt = "yyyy-mm-dd";
      }
    }
  }
  if (options.malformed) {
    workbook.getWorksheet("LUS")!.getCell("I10").value = new Date(
      Date.UTC(1900, 0, 15),
    );
  }
  await workbook.xlsx.writeFile(path);
}
