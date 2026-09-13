import { createReadStream } from "node:fs";
import { parse } from "csv-parse";
import { EXPECTED_PLANT_FIELDS } from "./constants.js";
import type { GrowDiagnostic, GrowPlantRecord, GrowRawValue } from "./types.js";

export interface PlantCsvResult {
  readonly plants: readonly GrowPlantRecord[];
  readonly diagnostics: readonly GrowDiagnostic[];
}

export async function readPlantCsv(path: string): Promise<PlantCsvResult> {
  const plants: GrowPlantRecord[] = [];
  const diagnostics: GrowDiagnostic[] = [];
  const seen = new Set<string>();
  const parser = createReadStream(path).pipe(
    parse({
      bom: true,
      columns: true,
      relax_quotes: false,
      skip_empty_lines: true,
    }),
  );
  let headersChecked = false;
  for await (const value of parser) {
    const row = value as Record<string, string | undefined>;
    if (!headersChecked) {
      headersChecked = true;
      const headers = Object.keys(row);
      if (
        headers.length !== EXPECTED_PLANT_FIELDS.length ||
        headers.some((header, index) => header !== EXPECTED_PLANT_FIELDS[index])
      ) {
        throw new Error(
          "GROW plant CSV header does not match the pinned release",
        );
      }
    }
    const sourceRecordId = (row.ID ?? "").trim();
    if (!/^\d+$/u.test(sourceRecordId)) {
      diagnostics.push({
        code: "INVALID_SOURCE_ID",
        severity: "error",
        message: "Plant row has no numeric Access ID.",
        sourceLocator: `export/edible-plants.csv#record=${plants.length + 2}`,
      });
      continue;
    }
    if (seen.has(sourceRecordId)) {
      diagnostics.push({
        code: "DUPLICATE_SOURCE_ID",
        severity: "error",
        message: `Duplicate plant identifier ${sourceRecordId}.`,
        sourceRecordId,
      });
      continue;
    }
    seen.add(sourceRecordId);
    const fields: Record<string, GrowRawValue> = {};
    for (const field of EXPECTED_PLANT_FIELDS) {
      const raw = row[field];
      fields[field] = raw === undefined || raw.length === 0 ? "" : raw;
    }
    plants.push({
      sourceRecordId,
      sourceLocator: `plant1.accdb#table=Edible%20plants&record.ID=${sourceRecordId}`,
      fields,
    });
  }
  if (!headersChecked) throw new Error("GROW plant CSV is empty");
  plants.sort(
    (left, right) => Number(left.sourceRecordId) - Number(right.sourceRecordId),
  );
  return { plants, diagnostics };
}
