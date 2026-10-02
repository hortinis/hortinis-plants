import { readFile, lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { validate } from "../schema/validation-api.js";
import { sourceRecordKey } from "../domain/source-keys.js";
import {
  assertSchema,
  contentDigest,
  field,
  object,
  records,
  same,
  type RecordValue,
} from "./curation-artifacts.js";
import {
  curationPaths,
  validateCurationDataset,
  auditCurationDecisionLineage,
  auditBaselines,
  type CurationOptions,
} from "./curation-validation.js";
import {
  validateGrowWfoDataset,
  collectionSchemaIds,
} from "./grow-wfo-validation.js";
import {
  auditPacketDecision,
  authoredRecords,
  packetForDecision,
  packetDecisionEvidence,
} from "./integrated-decision-lineage.js";
import { mintStableId } from "./grow-wfo-apply.js";
import {
  acquireDatasetLock,
  authoringFingerprint,
  readCollections,
  runDecisionTransaction,
  type TransactionPhase,
} from "./decision-transaction.js";

export interface IntegratedDecisionOperation {
  readonly kind:
    | "identity"
    | "subject"
    | "localization"
    | "context"
    | "assertion"
    | "comparison"
    | "issue";
  readonly source: RecordValue;
  readonly mintAlias: string;
  readonly reviewId: string;
  readonly disposition: "accept" | "reject" | "defer";
  readonly reason: string;
  readonly supersedesDecisionId?: string;
  readonly records: readonly {
    readonly collection: string;
    readonly mintAlias?: string;
    readonly previousValueSha256?: string;
    readonly value: RecordValue;
  }[];
}
export interface IntegratedDecisionInput {
  readonly schemaVersion: "1.0.0";
  readonly transactionId: string;
  readonly draftManifestSha256: string;
  readonly baseDatasetSha256: string;
  readonly datasetManifest?: RecordValue;
  readonly operations: readonly IntegratedDecisionOperation[];
  readonly batches?: readonly {
    readonly id: string;
    readonly members: readonly IntegratedDecisionOperation[];
  }[];
}
export interface CurationApplyOptions extends CurationOptions {
  /** Failure injection at the transaction boundary; not exposed by the CLI. */
  readonly onPhase?: (phase: TransactionPhase) => Promise<void>;
}

export async function applyCurationDecision(
  input: IntegratedDecisionInput,
  options: CurationApplyOptions = {},
) {
  const paths = curationPaths(options);
  const api = options.validationApi ?? { validate };
  assertSchema(
    api,
    "urn:hortinis:plants:schema:curation:v1:integrated-decision-input",
    input,
  );
  // Never copy or overwrite symlinked dataset content during a directory transaction.
  await rejectSymlinks(paths.dataset);
  const release = await acquireDatasetLock(paths.dataset);
  try {
    const baseline = await validateCurationDataset({ ...options, deep: true });
    if (
      baseline.loaded?.dataset.packetDecisions?.some(
        (row) => row.transactionId === input.transactionId,
      )
    )
      throw new Error(
        "Transaction already applied; replay or transaction ID reuse is rejected",
      );
    if (
      !baseline.valid ||
      baseline.loaded === undefined ||
      baseline.draft === undefined
    )
      throw new Error(
        `Current dataset or frozen inputs are invalid: ${[...baseline.structural.issues, ...baseline.sourceAudit.issues].map((row) => row.message).join("; ")}`,
      );
    if (baseline.draft.manifestSha256 !== input.draftManifestSha256)
      throw new Error("Decision input references a stale draft manifest");
    const actual = await authoringFingerprint(
      paths.dataset,
      baseline.loaded.manifest.collections,
    );
    if (actual !== input.baseDatasetSha256)
      throw new Error(
        "Decision input references a stale authoring dataset (including manifest)",
      );
    const originalManifest = await readFile(
      join(paths.dataset, "dataset-manifest.json"),
    );
    const previousManifest = object(JSON.parse(originalManifest.toString()));
    const manifest = input.datasetManifest ?? previousManifest;
    validateTransition(previousManifest, manifest);
    for (const dependency of records(baseline.draft.manifest.inputs).filter(
      (row) => String(row.role).startsWith("source-manifest-"),
    )) {
      if (
        !records(manifest.dependencies).some(
          (row) =>
            row.role === "source-manifest" &&
            row.id === dependency.id &&
            row.sha256 === dependency.sha256,
        )
      )
        throw new Error(
          `Explicit source dependency admission is required: ${String(dependency.role)}`,
        );
    }
    const descriptors = records(manifest.collections).map((row) => ({
      role: field(row, "role"),
      path: field(row, "path"),
      schemaId: field(row, "schemaId"),
    }));
    if (!descriptors.some((row) => row.role === "packet-decisions"))
      throw new Error(
        "Explicit manifest transition must declare packet-decisions",
      );
    const original = await readCollections(
      paths.dataset,
      baseline.loaded.manifest.collections,
    );
    const collections = new Map(
      [...original].map(([key, rows]) => [key, [...rows]]),
    );
    for (const descriptor of descriptors)
      if (!collections.has(descriptor.role))
        collections.set(descriptor.role, []);
    const operations = [...input.operations];
    const batchIds = new Set<string>();
    for (const batch of input.batches ?? []) {
      if (batchIds.has(batch.id))
        throw new Error(`Duplicate batch ${batch.id}`);
      batchIds.add(batch.id);
      operations.push(...batch.members);
    }
    const aliases = new Set<string>();
    const writes = new Set<string>();
    const decisions: RecordValue[] = [];
    let created = 0,
      unchanged = 0,
      replaced = 0;
    for (const operation of operations) {
      if (aliases.has(operation.mintAlias))
        throw new Error(`Duplicate operation alias ${operation.mintAlias}`);
      aliases.add(operation.mintAlias);
      const packet = packetForDecision(
        operation as unknown as RecordValue,
        baseline.draft,
      );
      const recordHistory: RecordValue[] = [];
      for (const entry of operation.records) {
        const descriptor = descriptors.find(
          (row) => row.role === entry.collection,
        );
        if (descriptor === undefined || entry.collection === "packet-decisions")
          throw new Error(
            `Undeclared or reserved collection ${entry.collection}`,
          );
        const value =
          typeof entry.value.id === "string" || entry.mintAlias === undefined
            ? entry.value
            : {
                ...entry.value,
                id: mintStableId(
                  input.transactionId,
                  entry.collection,
                  entry.mintAlias,
                ),
              };
        assertSchema(api, descriptor.schemaId, value);
        const id = field(value, "id");
        const rows = collections.get(entry.collection)!;
        const index = rows.findIndex((row) => row.id === id);
        const existing = rows[index];
        const key = `${entry.collection}:${id}`;
        if (
          writes.has(key) &&
          (existing === undefined || !same(existing, value))
        )
          throw new Error(`Conflicting transaction writes for ${id}`);
        writes.add(key);
        if (
          entry.previousValueSha256 !== undefined &&
          (existing === undefined ||
            contentDigest(existing) !== entry.previousValueSha256)
        )
          throw new Error(`Stale replacement precondition for ${id}`);
        let previousValue: RecordValue | undefined;
        if (existing === undefined) {
          rows.push(value);
          created += 1;
        } else if (same(existing, value)) {
          unchanged += 1;
        } else {
          if (
            entry.previousValueSha256 === undefined ||
            !["localized-names", "curation-issues"].includes(entry.collection)
          )
            throw new Error(
              `Record ${id} exists with different content; explicit supported replacement is required`,
            );
          if (
            entry.collection === "localized-names" &&
            !same({ ...existing, preferred: value.preferred }, value)
          )
            throw new Error(
              "Localized name replacement may only change preferred; new names require new IDs",
            );
          previousValue = existing;
          rows[index] = value;
          replaced += 1;
        }
        recordHistory.push({
          collection: entry.collection,
          id,
          value,
          ...(previousValue === undefined ? {} : { previousValue }),
        });
      }
      const decision: RecordValue = {
        id: mintStableId(
          input.transactionId,
          "packet-decisions",
          operation.mintAlias,
        ),
        transactionId: input.transactionId,
        draftManifestSha256: input.draftManifestSha256,
        kind: operation.kind,
        source: operation.source,
        reviewId: operation.reviewId,
        disposition: operation.disposition,
        reason: operation.reason,
        ...packetDecisionEvidence(
          operation.source,
          operation.kind,
          packet,
          baseline.draft,
        ),
        records: recordHistory,
        ...(operation.supersedesDecisionId === undefined
          ? {}
          : { supersedesDecisionId: operation.supersedesDecisionId }),
      };
      assertSchema(
        api,
        "urn:hortinis:plants:schema:authoring:v1:packet-decision",
        decision,
      );
      if (
        collections
          .get("packet-decisions")!
          .some((row) => row.id === decision.id)
      )
        throw new Error(
          "Transaction already contains an authored packet decision",
        );
      collections.get("packet-decisions")!.push(decision);
      decisions.push(decision);
      created += 1;
    }
    const loaded = baseline.loaded,
      draft = baseline.draft;
    const { datasetSha256, retainedBackup } = await runDecisionTransaction({
      directory: paths.dataset,
      collections,
      descriptors,
      original,
      ...(same(manifest, previousManifest) ? {} : { manifest }),
      ...(options.onPhase === undefined ? {} : { onPhase: options.onPhase }),
      fingerprint: (directory) => authoringFingerprint(directory, descriptors),
      validateStage: async (stage) => {
        const prospective = await validateGrowWfoDataset({
          repositoryRoot: paths.root,
          datasetDirectory: stage,
          validationApi: api,
        });
        if (!prospective.valid || prospective.loaded === undefined)
          throw new Error(
            `Transaction would produce an invalid dataset: ${prospective.issues.map((row) => row.message).join("; ")}`,
          );
        auditBaselines(prospective.loaded, draft);
        for (const decision of decisions)
          auditPacketDecision(decision, prospective.loaded.dataset, draft);
        auditCurationDecisionLineage(prospective.loaded.dataset, draft);
        // Every newly authored record belongs to at least one explicit packet decision;
        // schema-valid unrelated facts must not be smuggled through a broad operation.
        for (const decision of decisions)
          auditRecordConnections(decision, prospective.loaded.dataset);
      },
      beforePublish: async () => {
        const finalBaseline = await validateCurationDataset({
          ...options,
          deep: true,
        });
        if (
          !finalBaseline.valid ||
          finalBaseline.draft?.manifestSha256 !== input.draftManifestSha256 ||
          (await authoringFingerprint(
            paths.dataset,
            loaded.manifest.collections,
          )) !== actual
        )
          throw new Error(
            "Dataset or frozen inputs changed while the transaction was staged",
          );
      },
    });
    return {
      transactionId: input.transactionId,
      created,
      unchanged,
      replaced,
      decisions: decisions.length,
      outputCollections: [
        ...new Set(
          [...writes].map((key) => key.slice(0, key.indexOf(":"))),
        ).add("packet-decisions"),
      ].sort(),
      datasetSha256,
      ...(retainedBackup === undefined ? {} : { retainedBackup }),
    };
  } finally {
    await release();
  }
}

function validateTransition(previous: RecordValue, next: RecordValue): void {
  if (
    !records(previous.collections).some(
      (row) => row.role === "packet-decisions",
    ) &&
    previous.scope === next.scope
  )
    throw new Error(
      "First integrated transaction must explicitly select its editorial scope",
    );
  if (
    typeof next.reviewDraftCommand !== "string" ||
    !next.reviewDraftCommand.includes("curate:drafts")
  )
    throw new Error(
      "Integrated manifest must declare curate:drafts as its review draft command",
    );
  if (
    records(next.reviewBaseline).some(
      (row) =>
        row.role === "draft-manifest" ||
        row.role === "integrated-review-scope" ||
        String(row.role).startsWith("authoring-") ||
        String(row.role).includes("integrated-review-draft"),
    )
  )
    throw new Error(
      "Integrated manifest cannot pin its own authoring or draft snapshot",
    );
  for (const key of ["id", "schemaVersion"])
    if (previous[key] !== next[key])
      throw new Error(`Manifest transition cannot change ${key}`);
  for (const row of records(previous.collections))
    if (!records(next.collections).some((value) => same(row, value)))
      throw new Error(
        "Manifest transition cannot remove or change existing collections",
      );
  for (const row of records(previous.dependencies))
    if (!records(next.dependencies).some((value) => same(row, value)))
      throw new Error(
        "Manifest transition cannot remove or repin existing dependencies",
      );
  for (const row of records(next.collections))
    if (
      !records(previous.collections).some((value) => value.role === row.role) &&
      row.role !== "packet-decisions"
    )
      throw new Error(
        "Only the packet-decisions collection may be introduced by apply",
      );
}

function auditRecordConnections(
  decision: RecordValue,
  dataset: Parameters<typeof authoredRecords>[0],
): void {
  const entries = records(decision.records);
  const values = entries.map((row) => object(row.value));
  const graph = new Map<string, RecordValue>();
  for (const descriptor of Object.keys(collectionSchemaIds))
    for (const row of authoredRecords(dataset, descriptor))
      graph.set(field(row, "id"), row);
  const linked = new Set<string>();
  function visit(id: string): void {
    if (linked.has(id)) return;
    linked.add(id);
    const value = graph.get(id);
    if (value !== undefined) references(value, true);
  }
  function references(value: unknown, root = false): void {
    if (typeof value === "string") {
      if (graph.has(value)) visit(value);
    } else if (Array.isArray(value)) value.forEach((item) => references(item));
    else if (value !== null && typeof value === "object")
      for (const [key, item] of Object.entries(value)) {
        if (key === "id" && root) continue;
        if (
          key.endsWith("Id") ||
          key.endsWith("Ids") ||
          key === "id" ||
          key === "subject" ||
          key === "target" ||
          key === "rights" ||
          key === "geographicScope"
        )
          references(item);
      }
  }
  visit(field(decision, "reviewId"));
  const roots: Readonly<Record<string, readonly string[]>> = {
    identity: ["source-name-decisions"],
    subject: ["source-subject-mappings"],
    localization: ["localized-names"],
    context: ["cultivation-contexts", "source-geography-decisions"],
    assertion: ["source-assertion-decisions"],
    comparison: ["assertion-comparison-decisions"],
    issue: ["curation-issues"],
  };
  for (const entry of entries)
    if (roots[field(decision, "kind")]!.includes(field(entry, "collection")))
      visit(field(object(entry.value), "id"));
  for (const entry of entries.filter(
    (row) => row.collection === "taxonomic-names",
  )) {
    const value = object(entry.value);
    if (linked.has(String(value.taxonId))) visit(field(value, "id"));
  }
  for (const row of entries) {
    const collection = field(row, "collection");
    const value = object(row.value);
    if (!linked.has(field(value, "id")))
      throw new Error(
        `Authored ${collection} record is unrelated to operation`,
      );
    if (
      collection === "assertions" &&
      !values.some((item) => item.assertionId === value.id)
    )
      throw new Error("Assertion lacks individual source decision");
    if (
      !authoredRecords(dataset, collection).some((item) => item.id === value.id)
    )
      throw new Error("Packet decision references missing authored record");
  }
  if (sourceRecordKey(object(decision.source)) === undefined)
    throw new Error("Packet decision has no qualified source record");
}

async function rejectSymlinks(directory: string): Promise<void> {
  if ((await lstat(directory)).isSymbolicLink())
    throw new Error("Apply does not permit symlinked dataset paths");
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink())
      throw new Error(
        `Apply does not permit symlinked dataset content: ${entry.name}`,
      );
    if (entry.isDirectory()) await rejectSymlinks(path);
  }
}
