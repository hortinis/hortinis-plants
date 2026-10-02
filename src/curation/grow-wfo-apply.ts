import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { join, resolve } from "node:path";
import { serializeCanonicalJson } from "../serialization/canonical-json.js";
import { readJsonLines } from "../serialization/json-lines.js";
import { validate, type ValidationApi } from "../schema/validation-api.js";
import { validateGrowWfoDataset } from "./grow-wfo-validation.js";
import {
  readCollections,
  runDecisionTransaction,
  acquireDatasetLock,
} from "./decision-transaction.js";

type RecordValue = Readonly<Record<string, unknown>>;
type CollectionRole =
  | "taxa"
  | "taxonomic-names"
  | "plant-concepts"
  | "cultivar-groups"
  | "cultivars"
  | "localized-names"
  | "geographic-contexts"
  | "cultivation-contexts"
  | "evidence-references"
  | "reviews"
  | "external-taxonomy-crosswalks"
  | "source-name-decisions"
  | "source-subject-mappings"
  | "source-geography-decisions"
  | "source-assertion-decisions"
  | "assertions"
  | "curation-issues";

export interface DecisionInput {
  readonly schemaVersion: "1.0.0";
  readonly transactionId: string;
  readonly draftManifestSha256: string;
  readonly baseDatasetSha256?: string;
  readonly operations: readonly DecisionOperation[];
}

export interface DecisionOperation {
  readonly kind: "taxonomy" | "subject" | "geography" | "assertion" | "issue";
  readonly source: { readonly queueRole: string; readonly queueItemId: string };
  readonly records: readonly {
    readonly collection: CollectionRole;
    readonly mintAlias?: string;
    readonly value: RecordValue;
  }[];
}

export interface ApplyOptions {
  readonly repositoryRoot?: string;
  readonly datasetDirectory?: string;
  readonly draftsDirectory?: string;
  readonly validationApi?: ValidationApi;
}

export interface ApplyResult {
  readonly transactionId: string;
  readonly created: number;
  readonly unchanged: number;
  readonly outputCollections: readonly CollectionRole[];
  readonly datasetSha256: string;
  readonly retainedBackup?: string;
}

const inputSchemaId = "urn:hortinis:plants:schema:curation:v1:decision-input";
const draftPaths: Readonly<Record<string, string>> = {
  "identity-review-queue": "identity-review-queue.jsonl",
  "subject-mapping-review-queue": "subject-mapping-review-queue.jsonl",
  "assertion-review-queue": "assertion-review-queue.jsonl",
  "taxonomy-crosswalk-review-queue": "taxonomy-crosswalk-review-queue.jsonl",
  "geographic-context-review-queue": "geographic-context-review-queue.jsonl",
  "curation-issues": "curation-issues.jsonl",
};
const schemaIds: Readonly<Record<CollectionRole, string>> = {
  taxa: "urn:hortinis:plants:schema:v1:taxon",
  "taxonomic-names": "urn:hortinis:plants:schema:v1:taxonomic-name",
  "plant-concepts": "urn:hortinis:plants:schema:v1:plant-concept",
  "cultivar-groups": "urn:hortinis:plants:schema:v1:cultivar-group",
  cultivars: "urn:hortinis:plants:schema:v1:cultivar",
  "localized-names": "urn:hortinis:plants:schema:v1:localized-name",
  "geographic-contexts": "urn:hortinis:plants:schema:v1:geographic-context",
  "cultivation-contexts": "urn:hortinis:plants:schema:v1:cultivation-context",
  "evidence-references": "urn:hortinis:plants:schema:v1:evidence-reference",
  reviews: "urn:hortinis:plants:schema:v1:review",
  "external-taxonomy-crosswalks":
    "urn:hortinis:plants:schema:authoring:v1:external-taxonomy-crosswalk",
  "source-name-decisions":
    "urn:hortinis:plants:schema:authoring:v1:source-name-decision",
  "source-subject-mappings":
    "urn:hortinis:plants:schema:authoring:v1:source-subject-mapping",
  "source-geography-decisions":
    "urn:hortinis:plants:schema:authoring:v1:source-geography-decision",
  "source-assertion-decisions":
    "urn:hortinis:plants:schema:authoring:v1:source-assertion-decision",
  assertions: "urn:hortinis:plants:schema:authoring:v1:assertion",
  "curation-issues": "urn:hortinis:plants:schema:authoring:v1:curation-issue",
};

/** Historical input adapter sharing the directory transaction and writer lock. */
export async function applyGrowWfoDecision(
  input: DecisionInput,
  options: ApplyOptions = {},
): Promise<ApplyResult> {
  const root = resolve(
    options.repositoryRoot ?? resolve(import.meta.dirname, "../.."),
  );
  const directory = resolve(
    options.datasetDirectory ?? join(root, "data/curation/grow-wfo-initial"),
  );
  const release = await acquireDatasetLock(directory);
  try {
    return await applyHistoricalDecision(input, options);
  } finally {
    await release();
  }
}

/** Apply one explicit, draft-pinned transaction to the tracked authoring dataset. */
async function applyHistoricalDecision(
  input: DecisionInput,
  options: ApplyOptions = {},
): Promise<ApplyResult> {
  const repositoryRoot = resolve(
    options.repositoryRoot ?? resolve(import.meta.dirname, "../.."),
  );
  const datasetDirectory = resolve(
    options.datasetDirectory ??
      join(repositoryRoot, "data/curation/grow-wfo-initial"),
  );
  const draftsDirectory = resolve(
    options.draftsDirectory ??
      join(repositoryRoot, ".cache/curation-drafts/grow-wfo/latest"),
  );
  const validationApi = options.validationApi ?? { validate };
  const inputResult = validationApi.validate(inputSchemaId, input);
  if (!inputResult.valid)
    throw new Error(
      `Decision input is invalid: ${inputResult.errors.map((error) => `${error.instancePath} ${error.message}`).join("; ")}`,
    );

  const current = await validateGrowWfoDataset({
    repositoryRoot,
    datasetDirectory,
    draftsDirectory,
    againstDrafts: true,
    validationApi,
  });
  if (!current.valid || current.loaded === undefined)
    throw new Error(
      `Current C4 dataset is invalid: ${current.issues.map((issue) => `${issue.code}: ${issue.message}`).join("; ")}`,
    );
  const draftManifestPath = join(draftsDirectory, "draft-manifest.json");
  const draftBytes = await readFile(draftManifestPath);
  if (sha256(draftBytes) !== input.draftManifestSha256)
    throw new Error("Decision input references a stale draft manifest");
  if (input.baseDatasetSha256 !== undefined) {
    const actual = await datasetFingerprint(
      datasetDirectory,
      current.loaded.manifest.collections,
    );
    if (actual !== input.baseDatasetSha256)
      throw new Error("Decision input references a stale authoring dataset");
  }

  const collections = await readCollections(
    datasetDirectory,
    current.loaded.manifest.collections,
  );
  const queueCache = new Map<string, ReadonlyMap<string, RecordValue>>();
  let created = 0;
  let unchanged = 0;
  for (const operation of input.operations) {
    const allowedQueues: Readonly<
      Record<DecisionOperation["kind"], readonly string[]>
    > = {
      taxonomy: ["identity-review-queue", "taxonomy-crosswalk-review-queue"],
      subject: ["subject-mapping-review-queue"],
      geography: ["geographic-context-review-queue"],
      assertion: ["assertion-review-queue"],
      issue: ["curation-issues"],
    };
    if (!allowedQueues[operation.kind].includes(operation.source.queueRole))
      throw new Error(
        `Operation ${operation.kind} cannot use draft queue ${operation.source.queueRole}`,
      );
    const path = draftPaths[operation.source.queueRole];
    if (path === undefined)
      throw new Error(`Unknown draft queue ${operation.source.queueRole}`);
    let queue = queueCache.get(operation.source.queueRole);
    if (queue === undefined) {
      queue = await readQueue(join(draftsDirectory, path));
      queueCache.set(operation.source.queueRole, queue);
    }
    if (!queue.has(operation.source.queueItemId))
      throw new Error(
        `Decision references missing draft item ${operation.source.queueItemId}`,
      );
    for (const entry of operation.records) {
      const materialized = materializeRecord(
        input.transactionId,
        entry.collection,
        entry.mintAlias,
        entry.value,
      );
      const schemaId = schemaIds[entry.collection];
      const result = validationApi.validate(schemaId, materialized);
      if (!result.valid)
        throw new Error(
          `Invalid ${entry.collection} record ${typeof materialized.id === "string" ? materialized.id : "<missing>"}: ${result.errors.map((error) => error.message).join("; ")}`,
        );
      if (
        entry.collection === "source-assertion-decisions" &&
        materialized.draftManifestSha256 !== input.draftManifestSha256
      )
        throw new Error("Assertion decision has a stale draft fingerprint");
      const existing = collections.get(entry.collection) ?? [];
      const id = materialized.id;
      if (typeof id !== "string")
        throw new Error(`Record in ${entry.collection} has no id`);
      const same = existing.find((record) => record.id === id);
      if (same !== undefined) {
        if (
          !Buffer.from(serializeCanonicalJson(same)).equals(
            Buffer.from(serializeCanonicalJson(materialized)),
          )
        )
          throw new Error(`Record ${id} already exists with different content`);
        unchanged += 1;
        continue;
      }
      collections.set(entry.collection, [...existing, materialized]);
      created += 1;
    }
  }

  const descriptors = current.loaded.manifest.collections;
  const result = await runDecisionTransaction({
    directory: datasetDirectory,
    collections,
    descriptors,
    fingerprint: (directory) => datasetFingerprint(directory, descriptors),
    validateStage: async (stage) => {
      const stagedValidation = await validateGrowWfoDataset({
        repositoryRoot,
        datasetDirectory: stage,
        draftsDirectory,
        againstDrafts: true,
        validationApi,
      });
      if (!stagedValidation.valid)
        throw new Error(
          `Transaction would produce an invalid C4 dataset: ${stagedValidation.issues.map((issue) => `${issue.code}: ${issue.message}`).join("; ")}`,
        );
    },
  });
  return {
    ...result,
    transactionId: input.transactionId,
    created,
    unchanged,
    outputCollections: [
      ...new Set(
        input.operations.flatMap((operation) =>
          operation.records.map((record) => record.collection),
        ),
      ),
    ].sort(),
  };
}

/** Deterministically mint an opaque ID without depending on paths or array order. */
export function mintStableId(
  transactionId: string,
  collection: string,
  alias: string,
): string {
  const digest = createHash("sha256")
    .update(`hortinis:c4:${transactionId}:${collection}:${alias}`)
    .digest("hex")
    .slice(0, 32);
  return `c4-${collection}-${digest}`;
}

function materializeRecord(
  transactionId: string,
  collection: CollectionRole,
  alias: string | undefined,
  value: RecordValue,
): RecordValue {
  if (typeof value.id === "string") return value;
  if (alias === undefined) return value;
  return { ...value, id: mintStableId(transactionId, collection, alias) };
}

export async function datasetFingerprint(
  directory: string,
  descriptors: readonly { readonly path: string }[],
): Promise<string> {
  const hash = createHash("sha256");
  for (const descriptor of [...descriptors].sort((a, b) =>
    a.path.localeCompare(b.path),
  )) {
    const bytes = await readFile(join(directory, descriptor.path));
    hash.update(descriptor.path);
    hash.update("\0");
    hash.update(bytes);
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function readQueue(
  path: string,
): Promise<ReadonlyMap<string, RecordValue>> {
  const records = new Map<string, RecordValue>();
  for await (const entry of readJsonLines(createReadStream(path))) {
    const value = entry.value as RecordValue;
    if (typeof value.id === "string") records.set(value.id, value);
  }
  return records;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
