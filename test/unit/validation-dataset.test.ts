import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  validateValidationDataset,
  type DatasetRecord,
  type ValidationDataset,
} from "../../src/curation/validation-dataset.js";

const root = join(process.cwd(), "data/validation/v1.2");

async function readRecords(file: string): Promise<DatasetRecord[]> {
  const text = await readFile(join(root, file), "utf8");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as DatasetRecord);
}

describe("V1.2 validation dataset", () => {
  it("has resolvable curated references and distinct cultivar rules", async () => {
    const dataset: ValidationDataset = {
      taxa: await readRecords("taxa.jsonl"),
      plantConcepts: await readRecords("plant-concepts.jsonl"),
      cultivars: await readRecords("cultivars.jsonl"),
      contexts: await readRecords("cultivation-contexts.jsonl"),
      rules: await readRecords("cultivation-rules.jsonl"),
      assertions: await readRecords("assertions.jsonl"),
      evidence: await readRecords("evidence-references.jsonl"),
      reviews: await readRecords("reviews.jsonl"),
    };

    expect(validateValidationDataset(dataset)).toEqual([]);
    expect(dataset.cultivars).toHaveLength(2);
    expect(dataset.rules.filter((rule) => rule.cultivarId)).toHaveLength(2);
  });
});
