import { cp, mkdtemp, readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyGrowWfoDecision } from "../../src/curation/grow-wfo-apply.js";
import { getCompiledValidationApi } from "../support/compiled-validation-api.js";

const root = process.cwd();
const datasetSource = join(root, "data/curation/grow-wfo-initial");
const drafts = join(root, ".cache/curation-drafts/grow-wfo/latest");

describe("GROW/WFO transactional decision application", () => {
  it("mints deterministic IDs and publishes a validated transaction", async () => {
    const first = await copyDataset();
    const second = await copyDataset();
    const draftHash = sha256(
      await readFile(join(drafts, "draft-manifest.json")),
    );
    const input = {
      schemaVersion: "1.0.0" as const,
      transactionId: "transaction-test",
      draftManifestSha256: draftHash,
      operations: [
        {
          kind: "issue" as const,
          source: {
            queueRole: "curation-issues",
            queueItemId: "issue_subject_mapping_1",
          },
          records: [
            {
              collection: "curation-issues" as const,
              mintAlias: "example",
              value: {
                kind: "unresolved-mapping",
                status: "open",
                affectedRecordIds: ["1"],
                reason: "Test transaction",
              },
            },
          ],
        },
      ],
    };
    const api = await getCompiledValidationApi();
    const firstResult = await applyGrowWfoDecision(input, {
      repositoryRoot: root,
      datasetDirectory: first,
      draftsDirectory: drafts,
      validationApi: api,
    });
    const secondResult = await applyGrowWfoDecision(input, {
      repositoryRoot: root,
      datasetDirectory: second,
      draftsDirectory: drafts,
      validationApi: api,
    });
    const repeatResult = await applyGrowWfoDecision(input, {
      repositoryRoot: root,
      datasetDirectory: first,
      draftsDirectory: drafts,
      validationApi: api,
    });
    expect(firstResult.datasetSha256).toBe(secondResult.datasetSha256);
    expect(firstResult.created).toBe(1);
    expect(secondResult.created).toBe(1);
    expect(repeatResult.created).toBe(0);
    expect(repeatResult.unchanged).toBe(1);
    expect(await readFile(join(first, "curation-issues.jsonl"))).toEqual(
      await readFile(join(second, "curation-issues.jsonl")),
    );
  }, 30_000);

  it("rejects stale drafts before writing", async () => {
    const directory = await copyDataset();
    const files = await snapshot(directory);
    await expect(
      applyGrowWfoDecision(
        {
          schemaVersion: "1.0.0",
          transactionId: "transaction-stale",
          draftManifestSha256: "0".repeat(64),
          operations: [
            {
              kind: "issue",
              source: {
                queueRole: "curation-issues",
                queueItemId: "issue_subject_mapping_1",
              },
              records: [
                {
                  collection: "curation-issues",
                  value: {
                    id: "issue_stale",
                    kind: "unresolved-mapping",
                    status: "open",
                    affectedRecordIds: ["1"],
                    reason: "stale",
                  },
                },
              ],
            },
          ],
        },
        {
          repositoryRoot: root,
          datasetDirectory: directory,
          draftsDirectory: drafts,
          validationApi: await getCompiledValidationApi(),
        },
      ),
    ).rejects.toThrow("stale draft manifest");
    expect(await snapshot(directory)).toEqual(files);
  }, 30_000);

  it("applies multiple operations and reports materialized counts", async () => {
    const directory = await copyDataset();
    const draftHash = sha256(
      await readFile(join(drafts, "draft-manifest.json")),
    );
    const api = await getCompiledValidationApi();
    const result = await applyGrowWfoDecision(
      {
        schemaVersion: "1.0.0",
        transactionId: "transaction-multiple-operations",
        draftManifestSha256: draftHash,
        operations: [
          {
            kind: "issue",
            source: {
              queueRole: "curation-issues",
              queueItemId: "issue_subject_mapping_1",
            },
            records: [
              {
                collection: "curation-issues",
                value: {
                  id: "issue-multiple-a",
                  kind: "unresolved-mapping",
                  status: "open",
                  affectedRecordIds: ["1"],
                  reason: "First operation",
                },
              },
            ],
          },
          {
            kind: "issue",
            source: {
              queueRole: "curation-issues",
              queueItemId: "issue_subject_mapping_10",
            },
            records: [
              {
                collection: "curation-issues",
                value: {
                  id: "issue-multiple-b",
                  kind: "unresolved-mapping",
                  status: "open",
                  affectedRecordIds: ["10"],
                  reason: "Second operation",
                },
              },
            ],
          },
        ],
      },
      {
        repositoryRoot: root,
        datasetDirectory: directory,
        draftsDirectory: drafts,
        validationApi: api,
      },
    );
    expect(result.created).toBe(2);
    expect(result.unchanged).toBe(0);
    expect(
      (await readFile(join(directory, "curation-issues.jsonl"))).toString(),
    ).toContain("issue-multiple-a");
    expect(
      (await readFile(join(directory, "curation-issues.jsonl"))).toString(),
    ).toContain("issue-multiple-b");
  }, 30_000);

  it("rejects source decisions that do not preserve draft lineage", async () => {
    const directory = await copyDataset();
    const files = await snapshot(directory);
    const draftHash = sha256(
      await readFile(join(drafts, "draft-manifest.json")),
    );
    await expect(
      applyGrowWfoDecision(
        {
          schemaVersion: "1.0.0",
          transactionId: "transaction-lineage",
          draftManifestSha256: draftHash,
          operations: [
            {
              kind: "taxonomy",
              source: {
                queueRole: "identity-review-queue",
                queueItemId: "identity_review_1",
              },
              records: [
                {
                  collection: "reviews",
                  value: {
                    id: "review-lineage",
                    purpose: "content",
                    status: "accepted",
                    reviewedAt: "2026-09-16T00:00:00Z",
                    reviewerId: "reviewer-test",
                  },
                },
                {
                  collection: "source-name-decisions",
                  value: {
                    id: "decision-lineage",
                    sourceRecordKey: {
                      source: {
                        sourceId: "source_grow_edible_plant_database",
                        sourceManifestId: "source_manifest_grow_epd_2020",
                        sourceReleaseId: "doi:10.15132/10000157",
                      },
                      recordId: "1",
                    },
                    sourceName: "Wrong name",
                    sourceLocator:
                      "plant1.accdb#table=Edible%20plants&record.ID=1",
                    decision: "reject",
                    reason: "Test lineage rejection",
                    reviewId: "review-lineage",
                  },
                },
              ],
            },
          ],
        },
        {
          repositoryRoot: root,
          datasetDirectory: directory,
          draftsDirectory: drafts,
          validationApi: await getCompiledValidationApi(),
        },
      ),
    ).rejects.toThrow("CANDIDATE_LINEAGE");
    expect(await snapshot(directory)).toEqual(files);
  }, 30_000);

  it("rejects subject decisions that do not preserve draft lineage", async () => {
    const directory = await copyDataset();
    const files = await snapshot(directory);
    const draftHash = sha256(
      await readFile(join(drafts, "draft-manifest.json")),
    );
    await expect(
      applyGrowWfoDecision(
        {
          schemaVersion: "1.0.0",
          transactionId: "transaction-subject-lineage",
          draftManifestSha256: draftHash,
          operations: [
            {
              kind: "subject",
              source: {
                queueRole: "subject-mapping-review-queue",
                queueItemId: "subject_mapping_review_1",
              },
              records: [
                {
                  collection: "reviews",
                  value: {
                    id: "review-subject-lineage",
                    purpose: "content",
                    status: "accepted",
                    reviewedAt: "2026-09-16T00:00:00Z",
                    reviewerId: "reviewer-test",
                  },
                },
                {
                  collection: "source-subject-mappings",
                  value: {
                    id: "mapping-subject-lineage",
                    sourceRecordKey: {
                      source: {
                        sourceId: "source_grow_edible_plant_database",
                        sourceManifestId: "source_manifest_grow_epd_2020",
                        sourceReleaseId: "doi:10.15132/10000157",
                      },
                      recordId: "1",
                    },
                    sourceLocator: "wrong-locator",
                    decision: "reject",
                    reason: "Test subject lineage rejection",
                    reviewId: "review-subject-lineage",
                  },
                },
              ],
            },
          ],
        },
        {
          repositoryRoot: root,
          datasetDirectory: directory,
          draftsDirectory: drafts,
          validationApi: await getCompiledValidationApi(),
        },
      ),
    ).rejects.toThrow("CANDIDATE_LINEAGE");
    expect(await snapshot(directory)).toEqual(files);
  }, 30_000);

  it("rolls back a transaction when staged cross-record validation fails", async () => {
    const directory = await copyDataset();
    const files = await snapshot(directory);
    const draftHash = sha256(
      await readFile(join(drafts, "draft-manifest.json")),
    );
    await expect(
      applyGrowWfoDecision(
        {
          schemaVersion: "1.0.0",
          transactionId: "transaction-rollback",
          draftManifestSha256: draftHash,
          operations: [
            {
              kind: "issue",
              source: {
                queueRole: "curation-issues",
                queueItemId: "issue_subject_mapping_1",
              },
              records: [
                {
                  collection: "curation-issues",
                  value: {
                    id: "issue-rollback-valid",
                    kind: "unresolved-mapping",
                    status: "open",
                    affectedRecordIds: ["1"],
                    reason: "Should not publish",
                  },
                },
              ],
            },
            {
              kind: "issue",
              source: {
                queueRole: "curation-issues",
                queueItemId: "issue_subject_mapping_10",
              },
              records: [
                {
                  collection: "curation-issues",
                  value: {
                    id: "issue-rollback-invalid",
                    kind: "missing-evidence",
                    status: "open",
                    affectedRecordIds: ["10"],
                    reason: "Missing reference",
                    evidenceReferenceIds: ["evidence-does-not-exist"],
                  },
                },
              ],
            },
          ],
        },
        {
          repositoryRoot: root,
          datasetDirectory: directory,
          draftsDirectory: drafts,
          validationApi: await getCompiledValidationApi(),
        },
      ),
    ).rejects.toThrow("invalid C4 dataset");
    expect(await snapshot(directory)).toEqual(files);
  }, 30_000);
});

async function copyDataset(): Promise<string> {
  const parent = await mkdtemp(join("/tmp", "hortinis-c4-apply-"));
  const directory = join(parent, "dataset");
  await cp(datasetSource, directory, { recursive: true });
  return directory;
}

async function snapshot(directory: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const file of await readdir(directory))
    result[file] = sha256(await readFile(join(directory, file)));
  return result;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
