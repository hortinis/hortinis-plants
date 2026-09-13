import ExcelJS from "exceljs";
import { EXPECTED_LOCATION_SHEETS } from "./constants.js";
import { parseMonthDay } from "./parse-values.js";
import type {
  GrowCalendarWindow,
  GrowDiagnostic,
  GrowLocation,
  MonthDay,
} from "./types.js";

const operationByHeader: Readonly<
  Record<string, GrowCalendarWindow["operation"]>
> = {
  "sow indoors / undercover": "indoors_or_undercover",
  "sow outdoors / plant out": "outdoor_sowing_or_planting",
  harvest: "harvest",
};

export interface CalendarResult {
  readonly locations: readonly GrowLocation[];
  readonly windows: readonly GrowCalendarWindow[];
  readonly diagnostics: readonly GrowDiagnostic[];
  readonly plantNamesById: ReadonlyMap<
    string,
    { scientificName: string; commonName: string }
  >;
  readonly idsBySheet: Readonly<Record<string, readonly string[]>>;
}

export async function readCalendar(path: string): Promise<CalendarResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  const locations: GrowLocation[] = [];
  const windows: GrowCalendarWindow[] = [];
  const diagnostics: GrowDiagnostic[] = [];
  const plantNamesById = new Map<
    string,
    { scientificName: string; commonName: string }
  >();
  const idsBySheet: Record<string, readonly string[]> = {};
  const strata = readStrata(workbook.getWorksheet("Strata table"));

  for (const sheetCode of EXPECTED_LOCATION_SHEETS) {
    const sheet = workbook.getWorksheet(sheetCode);
    if (sheet === undefined) {
      throw new Error(`GROW workbook is missing sheet ${sheetCode}`);
    }
    const location = readLocation(sheetCode, sheet);
    const withStrata = {
      ...location,
      strataCodes: strata.filter((code) => code.startsWith(sheetCode)),
    };
    locations.push(withStrata);

    const headers = readOperationColumns(sheet);
    if (headers.length === 0)
      throw new Error(`No calendar operation headers on ${sheetCode}`);
    const idSet = new Set<string>();
    for (let rowNumber = 10; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      const idValue = row.getCell(1).value;
      if (typeof idValue !== "number" || !Number.isInteger(idValue)) continue;
      const sourceRecordId = String(idValue);
      if (idSet.has(sourceRecordId)) {
        diagnostics.push({
          code: "DUPLICATE_CALENDAR_ID",
          severity: "error",
          message: `Calendar sheet ${sheetCode} contains duplicate ID ${sourceRecordId}.`,
          sourceRecordId,
          sourceLocator: `PlantingCalendar.xlsx!${sheetCode}!A${rowNumber}`,
        });
        continue;
      }
      idSet.add(sourceRecordId);
      const sourceName = text(row.getCell(2).value);
      const sourceCommonName = text(row.getCell(3).value);
      const previousNames = plantNamesById.get(sourceRecordId);
      if (previousNames === undefined) {
        plantNamesById.set(sourceRecordId, {
          scientificName: sourceName,
          commonName: sourceCommonName,
        });
      } else if (
        previousNames.scientificName !== sourceName ||
        previousNames.commonName !== sourceCommonName
      ) {
        diagnostics.push({
          code: "SOURCE_NAME_DRIFT",
          severity: "warning",
          message: `Calendar names differ from another source row for plant ${sourceRecordId}.`,
          sourceRecordId,
          sourceLocator: `PlantingCalendar.xlsx!${sheetCode}!B${rowNumber}:C${rowNumber}`,
          originalValue: {
            scientificName: sourceName,
            commonName: sourceCommonName,
          },
        });
      }

      for (const column of headers) {
        const startValue = row.getCell(column.startColumn).value;
        const endValue = row.getCell(column.endColumn).value;
        if (isEmpty(startValue) && isEmpty(endValue)) continue;
        const locator = `PlantingCalendar.xlsx!${sheetCode}!${columnLetter(column.startColumn)}${rowNumber}:${columnLetter(column.endColumn)}${rowNumber}`;
        if (
          row.getCell(column.startColumn).type === ExcelJS.ValueType.Formula ||
          row.getCell(column.endColumn).type === ExcelJS.ValueType.Formula
        ) {
          diagnostics.push({
            code: "FORMULA_CALENDAR_VALUE",
            severity: "warning",
            message:
              "Expected source date values; formula cells are not imported.",
            sourceRecordId,
            sourceLocator: locator,
          });
          continue;
        }
        const start = parseMonthDay(excelDate(startValue));
        const end = parseMonthDay(excelDate(endValue));
        if (start === undefined || end === undefined) {
          diagnostics.push({
            code: "INVALID_CALENDAR_WINDOW",
            severity: "warning",
            message:
              "Calendar window contains a missing, malformed, or non-2017 date.",
            sourceRecordId,
            sourceLocator: locator,
            originalValue: {
              start: serializableCell(startValue),
              end: serializableCell(endValue),
            },
          });
          continue;
        }
        windows.push({
          sourceRecordId,
          sourceLocator: locator,
          sourceName,
          sourceCommonName,
          location: withStrata,
          season: column.season,
          operation: column.operation,
          start,
          end,
          precision: "day",
          crossesYearBoundary: compareMonthDay(start, end) > 0,
        });
        if (column.operation === "outdoor_sowing_or_planting") {
          diagnostics.push({
            code: "AMBIGUOUS_OUTDOOR_OPERATION",
            severity: "warning",
            message:
              "Source header combines direct sowing and planting out; action is unresolved.",
            sourceRecordId,
            sourceLocator: locator,
          });
        }
      }
    }
    idsBySheet[sheetCode] = [...idSet].sort((a, b) => Number(a) - Number(b));
  }

  windows.sort((a, b) =>
    compareTuple(
      [a.sourceRecordId, a.location.sheetCode, a.season, a.operation],
      [b.sourceRecordId, b.location.sheetCode, b.season, b.operation],
    ),
  );
  return { locations, windows, diagnostics, plantNamesById, idsBySheet };
}

interface OperationColumn {
  readonly operation: GrowCalendarWindow["operation"];
  readonly season: 1 | 2;
  readonly startColumn: number;
  readonly endColumn: number;
}

function readOperationColumns(sheet: ExcelJS.Worksheet): OperationColumn[] {
  const columns: OperationColumn[] = [];
  for (
    let startColumn = 4;
    startColumn <= sheet.getRow(9).cellCount;
    startColumn += 1
  ) {
    const rawOperation = text(
      sheet.getRow(8).getCell(startColumn).value,
    ).toLocaleLowerCase("en");
    if (rawOperation.length === 0) continue;
    const operation = operationByHeader[rawOperation];
    if (operation === undefined)
      throw new Error(
        `Unknown GROW action header ${rawOperation} on ${sheet.name}`,
      );
    const endColumn = startColumn + 1;
    const seasonLabel = text(
      sheet.getRow(7).getCell(startColumn).value,
    ).toLocaleLowerCase("en");
    const season: 1 | 2 = seasonLabel.includes("2") ? 2 : 1;
    const nextAction = text(
      sheet.getRow(8).getCell(endColumn).value,
    ).toLocaleLowerCase("en");
    if (nextAction !== rawOperation)
      throw new Error(
        `Unpaired date columns for ${rawOperation} on ${sheet.name}`,
      );
    columns.push({ operation, season, startColumn, endColumn });
    startColumn += 1;
  }
  return columns;
}

function readLocation(
  sheetCode: string,
  sheet: ExcelJS.Worksheet,
): Omit<GrowLocation, "strataCodes"> {
  const rawName =
    text(sheet.getCell("A1").value) || text(sheet.getCell("C6").value);
  const coordinateText = text(sheet.getCell("C2").value);
  const match =
    /([0-9]+(?:\.[0-9]+)?)°\s*([NS])\s*,\s*([0-9]+(?:\.[0-9]+)?)°\s*([EW])/u.exec(
      coordinateText,
    );
  if (match === null)
    throw new Error(`Invalid coordinates on GROW sheet ${sheetCode}`);
  const latitude = Number(match[1]) * (match[2] === "S" ? -1 : 1);
  const longitude = Number(match[3]) * (match[4] === "W" ? -1 : 1);
  const [country = rawName] = rawName.split(" (");
  return {
    sheetCode,
    name: rawName,
    country: country.trim(),
    latitude,
    longitude,
  };
}

function readStrata(sheet: ExcelJS.Worksheet | undefined): string[] {
  if (sheet === undefined)
    throw new Error("GROW workbook is missing Strata table");
  const codes: string[] = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const code = text(sheet.getRow(rowNumber).getCell(3).value);
    if (/^[A-Z]{3}\d+$/u.test(code)) codes.push(code);
  }
  return codes.sort();
}

function excelDate(value: unknown): Date | undefined {
  if (value instanceof Date) return value;
  if (typeof value === "object" && value !== null && "result" in value) {
    return excelDate(value.result);
  }
  return undefined;
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  if (value instanceof Date) return value.toISOString();
  if (
    typeof value === "object" &&
    "text" in value &&
    typeof value.text === "string"
  ) {
    return value.text.trim();
  }
  if (
    typeof value === "object" &&
    "richText" in value &&
    Array.isArray(value.richText)
  ) {
    const richText: unknown = value.richText;
    if (!Array.isArray(richText)) return "";
    return richText
      .map((fragment) => (isRecord(fragment) ? text(fragment.text) : ""))
      .join("");
  }
  if (typeof value === "object" && "result" in value) return text(value.result);
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function serializableCell(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : (value ?? null);
}

function compareMonthDay(left: MonthDay, right: MonthDay): number {
  return left.month - right.month || left.day - right.day;
}

function compareTuple(
  left: readonly (string | number)[],
  right: readonly (string | number)[],
): number {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const a = left[index]!;
    const b = right[index]!;
    const result =
      typeof a === "number" && typeof b === "number"
        ? a - b
        : String(a).localeCompare(String(b));
    if (result !== 0) return result;
  }
  return left.length - right.length;
}

function columnLetter(column: number): string {
  let value = column;
  let letters = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    value = Math.floor((value - 1) / 26);
  }
  return letters;
}
