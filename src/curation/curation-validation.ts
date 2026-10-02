import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  qualifiedSourceRecordKey,
  sourceLocationKey,
  sourceRecordKey,
} from "../domain/source-keys.js";
import { WFO_SNAPSHOT_FILENAME } from "../adapters/wfo/constants.js";
import { CROPGRAPH_SOURCE_RELEASE_ID } from "../adapters/cropgraph/constants.js";
import { validate, type ValidationApi } from "../schema/validation-api.js";
import {
  validateGrowWfoDataset,
  type CurationValidationIssue,
  type LoadedCurationDataset,
} from "./grow-wfo-validation.js";
import {
  readIntegratedReviewDraft,
  type IntegratedReviewDraft,
} from "./integrated-review-reader.js";
import {
  RUN_SCHEMA,
  containedPath,
  contentDigest,
  digest,
  field,
  object,
  readObject,
  records,
  same,
  strings,
  uniqueBy,
  verifyArtifact,
  type RecordValue,
} from "./curation-artifacts.js";
import type { ValidationDataset } from "./validation-dataset.js";
import { auditPacketDecisions } from "./integrated-decision-lineage.js";
import {
  collectAuthoredDecisions,
  rightsForSource,
  wfoIdentifiersFromCandidate,
} from "./integrated-review-packets.js";

export interface CurationOptions {
  readonly repositoryRoot?: string;
  readonly datasetDirectory?: string;
  readonly draftsDirectory?: string;
  readonly scopePath?: string;
  readonly cohortPath?: string;
  readonly deep?: boolean;
  readonly runDirectories?: Readonly<Record<string, string>>;
  readonly sourceDirectories?: Readonly<Record<string, string>>;
  /** Explicit local paths for source locators or roles, never fetched over the network. */
  readonly inputPaths?: Readonly<Record<string, string>>;
  readonly validationApi?: ValidationApi;
}

export interface ValidationDimension {
  readonly status: "planned" | "in progress" | "validated" | "blocked";
  readonly valid: boolean | null;
  readonly issues: readonly CurationValidationIssue[];
}

export interface CurationValidationResult {
  readonly valid: boolean;
  readonly structural: ValidationDimension;
  readonly sourceAudit: ValidationDimension;
  readonly loaded?: LoadedCurationDataset;
  readonly draft?: IntegratedReviewDraft;
}

export function curationPaths(options: CurationOptions): {
  root: string;
  dataset: string;
  drafts: string;
} {
  const root = resolve(
    options.repositoryRoot ?? resolve(import.meta.dirname, "../.."),
  );
  return {
    root,
    dataset: resolve(
      options.datasetDirectory ?? join(root, "data/curation/grow-wfo-initial"),
    ),
    drafts: resolve(
      options.draftsDirectory ??
        join(root, ".cache/curation-drafts/integrated/latest"),
    ),
  };
}

/** Structural checks never depend on cached artifacts. Deep checks are explicitly requested. */
export async function validateCurationDataset(
  options: CurationOptions = {},
): Promise<CurationValidationResult> {
  const paths = curationPaths(options);
  const api = options.validationApi ?? { validate };
  const structural = await validateGrowWfoDataset({
    repositoryRoot: paths.root,
    datasetDirectory: paths.dataset,
    validationApi: api,
  });
  let sourceAudit: ValidationDimension = {
    status: "planned",
    valid: null,
    issues: [],
  };
  let draft: IntegratedReviewDraft | undefined;
  if (options.deep) {
    try {
      draft = await readIntegratedReviewDraft({
        directory: paths.drafts,
        validationApi: api,
        ...(options.scopePath === undefined
          ? {}
          : { scopePath: options.scopePath }),
      });
      await auditInputs(draft, options, api);
      if (structural.loaded !== undefined) {
        auditBaselines(structural.loaded, draft);
        auditAuthoredSnapshots(structural.loaded.dataset, draft);
        auditCurationDecisionLineage(structural.loaded.dataset, draft);
        auditPacketDecisions(structural.loaded.dataset, draft);
      }
      sourceAudit = { status: "validated", valid: true, issues: [] };
    } catch (error) {
      sourceAudit = {
        status: "blocked",
        valid: false,
        issues: [
          {
            code: "SOURCE_AUDIT_FAILED",
            path: paths.drafts,
            message: error instanceof Error ? error.message : String(error),
          },
        ],
      };
    }
  }
  return {
    valid: structural.valid && sourceAudit.valid !== false,
    structural: {
      status: structural.valid ? "validated" : "blocked",
      valid: structural.valid,
      issues: structural.issues,
    },
    sourceAudit,
    ...(structural.loaded === undefined ? {} : { loaded: structural.loaded }),
    ...(draft === undefined ? {} : { draft }),
  };
}

async function auditInputs(
  draft: IntegratedReviewDraft,
  options: CurationOptions,
  api: ValidationApi,
): Promise<void> {
  const paths = curationPaths(options);
  const inputs = uniqueBy(records(draft.manifest.inputs), (input) =>
    field(input, "role"),
  );
  const runRoles = [
    "grow-importer-run-manifest",
    "cropgraph-importer-run-manifest",
    "wfo-reconciliation-run-manifest",
    "taxref-wfo-reconciliation-run-manifest",
  ];
  const runPaths = new Map<string, string>();
  for (const role of runRoles) {
    const input = inputs.get(role);
    if (input === undefined) throw new Error(`Missing draft input ${role}`);
    const override = options.runDirectories?.[role];
    runPaths.set(
      role,
      override === undefined
        ? await localPath(field(input, "locator"))
        : join(
            resolve(override),
            role.includes("importer")
              ? "importer-run-manifest.json"
              : "reconciliation-run-manifest.json",
          ),
    );
  }
  const aliases = new Map([
    ["grow-import-run", "grow-importer-run-manifest"],
    ["cropgraph-import-run", "cropgraph-importer-run-manifest"],
  ]);
  const visited = new Map<string, RecordValue>();
  const runs = new Map<string, RecordValue>();
  const sourceManifests = new Map<string, RecordValue>();
  if (!inputs.has("authoring-dataset-manifest"))
    throw new Error("Missing authoring-dataset-manifest input");
  for (const kind of ["grow", "cropgraph", "wfo", "taxref"]) {
    const input = inputs.get(`source-manifest-${kind}`);
    if (input === undefined) throw new Error(`Missing source-manifest-${kind}`);
    const path = await localPath(field(input, "locator"));
    const value = (await verifyArtifact(path, input, api, "json", true))[0]!;
    if (value.id !== input.id)
      throw new Error(`Source manifest ID differs: ${path}`);
    sourceManifests.set(kind, value);
  }
  for (const source of records(draft.scope.sources)) {
    const manifest = sourceManifests.get(field(source, "kind"));
    if (
      manifest === undefined ||
      source.sourceManifestId !== manifest.id ||
      source.sourceReleaseId !== object(manifest.release).identifier
    )
      throw new Error(`Scope source release differs: ${field(source, "kind")}`);
  }
  const manifestsByKind = {
    grow: sourceManifests.get("grow")!,
    cropgraph: sourceManifests.get("cropgraph")!,
    wfo: sourceManifests.get("wfo")!,
    taxref: sourceManifests.get("taxref")!,
  };
  for (const packet of draft.packets) {
    const expected = rightsForSource(
      packet.sourceKind === "grow" ? "grow" : "cropgraph",
      manifestsByKind,
      [
        ...records(packet.identityCandidates),
        ...records(packet.cultivationCandidates),
      ],
    );
    if (!same(expected, packet.rightsEvidence))
      throw new Error(`Packet rights evidence differs: ${field(packet, "id")}`);
  }
  for (const [role, path] of runPaths) {
    const input = inputs.get(role)!;
    await auditRun(path, input, role);
  }
  for (const input of inputs.values()) {
    const locator = field(input, "locator");
    if (
      runPaths.has(field(input, "role")) ||
      field(input, "role").startsWith("source-manifest-")
    )
      continue;
    const role = field(input, "role");
    let path: string;
    if (role === "authoring-dataset-manifest")
      path = join(paths.dataset, "dataset-manifest.json");
    else if (role.startsWith("authoring-collection-")) {
      const selectedManifest = await readObject(
        join(paths.dataset, "dataset-manifest.json"),
      );
      const collection = records(selectedManifest.collections).find(
        (row) => row.role === role.slice("authoring-collection-".length),
      );
      if (collection === undefined)
        throw new Error(`Missing declared authoring collection ${role}`);
      path = await containedPath(paths.dataset, field(collection, "path"));
    } else if (role === "cropgraph-cohort" && options.cohortPath !== undefined)
      path = resolve(options.cohortPath);
    else path = await localPath(locator, role);
    const format = locator.endsWith(".jsonl")
      ? "jsonl"
      : locator.endsWith(".json")
        ? "json"
        : "bytes";
    await verifyArtifact(path, input, api, format);
  }
  const cohortPath =
    options.cohortPath ??
    join(paths.root, "data/sources/cropgraph/cohort.json");
  const cohortBytes = await readFile(cohortPath);
  const cohort = await readObject(cohortPath);
  const fingerprint = records(draft.scope.fingerprints).find(
    (row) => row.role === "cropgraph-cohort",
  );
  if (
    fingerprint === undefined ||
    fingerprint.sha256 !== digest(cohortBytes) ||
    fingerprint.byteSize !== cohortBytes.byteLength
  )
    throw new Error(`Cohort differs from frozen scope: ${cohortPath}`);
  const selected = draft.packets
    .filter((packet) => packet.sourceKind === "cropgraph")
    .map((packet) => field(object(packet.sourceRecordKey), "recordId"))
    .sort();
  if (
    !same([...strings(cohort.include)].sort(), selected) ||
    strings(cohort.include).length !== new Set(strings(cohort.include)).size
  )
    throw new Error(
      "Selected packets differ from the explicit CropGraph cohort",
    );
  const cropRun = runs.get("cropgraph-importer-run-manifest")!;
  if (object(cropRun.configuration).cohortSha256 !== digest(cohortBytes))
    throw new Error("CropGraph configuration cohort differs");
  auditPacketDependencies(draft, runs, inputs);
  const proposalCount = records(
    runs.get("taxref-wfo-reconciliation-run-manifest")!.outputs,
  ).find((row) => row.path === "localization-proposals.jsonl")?.recordCount;
  if (
    records(draft.scope.counts).find(
      (row) => row.role === "localization-proposals",
    )?.count !== proposalCount
  )
    throw new Error("Scope localization count differs from TAXREF run");

  async function localPath(locator: string, role?: string): Promise<string> {
    const override =
      options.inputPaths?.[locator] ??
      (role === undefined ? undefined : options.inputPaths?.[role]);
    if (override !== undefined) return resolve(override);
    if (
      role === "taxref-archive" &&
      options.sourceDirectories?.taxref !== undefined
    )
      return resolve(options.sourceDirectories.taxref, "TAXREF_v18_2025.zip");
    const colon = locator.indexOf(":");
    if (colon !== -1 && !isAbsolute(locator)) {
      const prefix = locator.slice(0, colon);
      const runRole = aliases.get(prefix) ?? prefix;
      const runPath = runPaths.get(runRole);
      if (runPath !== undefined)
        return containedPath(dirname(runPath), locator.slice(colon + 1));
      if (role === "wfo-source-snapshot")
        return resolve(
          paths.root,
          `.cache/source-inputs/wfo/2026-06/${WFO_SNAPSHOT_FILENAME}`,
        );
      throw new Error(
        `No local input mapping for ${role ?? locator}; supply an input path`,
      );
    }
    return isAbsolute(locator) ? locator : containedPath(paths.root, locator);
  }

  async function auditRun(
    path: string,
    descriptor: RecordValue,
    role: string,
  ): Promise<void> {
    const schemaId =
      role.includes("importer") || role === "taxref-run-manifest"
        ? RUN_SCHEMA + "importer-run-manifest"
        : RUN_SCHEMA + "taxonomy-reconciliation-manifest";
    if (descriptor.schemaId !== undefined && descriptor.schemaId !== schemaId)
      throw new Error(`Run descriptor has the wrong schema: ${path}`);
    if (visited.has(path)) {
      const previous = visited.get(path)!;
      if (
        previous.sha256 !== descriptor.sha256 ||
        previous.byteSize !== descriptor.byteSize ||
        (descriptor.configurationSha256 !== undefined &&
          descriptor.configurationSha256 !== previous.configurationSha256)
      )
        throw new Error(`Conflicting run fingerprints: ${path}`);
      return;
    }
    visited.set(path, descriptor);
    const run = (
      await verifyArtifact(path, { ...descriptor, schemaId }, api, "json", true)
    )[0]!;
    runs.set(role, run);
    if (
      run.configurationSha256 !== contentDigest(run.configuration) ||
      (descriptor.configurationSha256 !== undefined &&
        descriptor.configurationSha256 !== run.configurationSha256)
    )
      throw new Error(`Run configuration digest differs: ${path}`);
    const kind = role.split("-")[0]!;
    if (run.sourceManifest !== undefined) {
      const manifestInput = inputs.get(`source-manifest-${kind}`);
      if (
        manifestInput === undefined ||
        object(run.sourceManifest).id !== manifestInput.id ||
        object(run.sourceManifest).sha256 !== manifestInput.sha256
      )
        throw new Error(`Run source manifest differs: ${path}`);
    }
    const outputs = records(run.outputs);
    uniqueBy(outputs, (output) => field(output, "path"));
    for (const output of outputs) {
      const outputPath = await containedPath(
        dirname(path),
        field(output, "path"),
      );
      const snapshotField =
        kind === "grow"
          ? output.path === "source-records.jsonl"
            ? "sourceRecord"
            : output.path === "candidates.jsonl"
              ? "cultivationCandidates"
              : undefined
          : kind === "cropgraph"
            ? output.path === "selected-records.jsonl"
              ? "sourceRecord"
              : output.path === "identity-candidates.jsonl"
                ? "identityCandidates"
                : output.path === "cultivation-candidates.jsonl"
                  ? "cultivationCandidates"
                  : undefined
            : kind === "wfo" && output.path === "taxon-match-candidates.jsonl"
              ? "taxonomyOutcomes"
              : role === "taxref-wfo-reconciliation-run-manifest"
                ? output.path === "link-outcomes.jsonl"
                  ? "localizationOutcomes"
                  : output.path === "localization-proposals.jsonl"
                    ? "localizationProposals"
                    : undefined
                : undefined;
      const snapshots =
        snapshotField === undefined
          ? []
          : draft.packets
              .filter((packet) =>
                ["grow", "cropgraph"].includes(kind)
                  ? packet.sourceKind === kind
                  : true,
              )
              .flatMap((packet) =>
                snapshotField === "sourceRecord"
                  ? [object(packet.sourceRecord)]
                  : records(packet[snapshotField]),
              );
      const key = (row: RecordValue) =>
        snapshotField === "sourceRecord"
          ? sourceRecordKey(row)!
          : field(row, "id");
      const expected = new Map(snapshots.map((row) => [key(row), row]));
      const seen = new Set<string>();
      await verifyArtifact(outputPath, output, api, "jsonl", false, (row) => {
        if (snapshotField === undefined) return;
        const id = key(row);
        if (seen.has(id))
          throw new Error(`Duplicate staged record ${id}: ${outputPath}`);
        seen.add(id);
        const snapshot = expected.get(id);
        if (snapshot !== undefined && !same(snapshot, row))
          throw new Error(`Packet snapshot differs from source output: ${id}`);
        if (
          snapshot === undefined &&
          ["grow", "cropgraph", "wfo"].includes(kind)
        )
          throw new Error(`Staged record is missing from packets: ${id}`);
      });
      for (const id of expected.keys())
        if (!seen.has(id))
          throw new Error(
            `Packet snapshot is absent from staged output: ${id}`,
          );
    }
    if (run.job !== undefined) {
      uniqueBy(records(run.inputs), (input) => field(input, "role"));
      for (const input of records(run.inputs)) {
        const inputRole = field(input, "role");
        const inputPath =
          inputRole === "wfo-run-manifest"
            ? runPaths.get("wfo-reconciliation-run-manifest")!
            : await localPath(field(input, "locator"), inputRole);
        if (inputRole.endsWith("run-manifest"))
          await auditRun(
            inputPath,
            input,
            inputRole === "wfo-run-manifest"
              ? "wfo-reconciliation-run-manifest"
              : inputRole,
          );
        else
          await verifyArtifact(
            inputPath,
            input,
            api,
            field(input, "locator").endsWith(".json")
              ? "json"
              : input.recordCount !== undefined ||
                  field(input, "locator").endsWith(".jsonl")
                ? "jsonl"
                : "bytes",
          );
      }
    } else {
      const sourceRoot = resolve(
        options.sourceDirectories?.[kind] ??
          join(
            paths.root,
            kind === "grow"
              ? "data/sources/grow/releases/2020"
              : kind === "cropgraph"
                ? `data/sources/cropgraph/releases/${CROPGRAPH_SOURCE_RELEASE_ID}`
                : ".cache/source-inputs/taxref/18.0",
          ),
      );
      for (const input of records(run.inputs)) {
        const locator = field(input, "locator");
        const inputPath =
          options.inputPaths?.[locator] ??
          (kind === "taxref"
            ? resolve(
                options.inputPaths?.["taxref-archive"] ??
                  join(sourceRoot, "TAXREF_v18_2025.zip"),
              )
            : await containedPath(sourceRoot, locator));
        await verifyArtifact(inputPath, input, api, "bytes");
      }
    }
  }
}

function auditPacketDependencies(
  draft: IntegratedReviewDraft,
  runs: ReadonlyMap<string, RecordValue>,
  inputs: ReadonlyMap<string, RecordValue>,
): void {
  const expected = new Map<string, unknown>([
    [
      "wfo-run-manifest",
      {
        role: "wfo-run-manifest",
        sha256: inputs.get("wfo-reconciliation-run-manifest")!.sha256,
      },
    ],
    [
      "taxref-run-manifest",
      {
        role: "taxref-run-manifest",
        sha256: inputs.get("taxref-wfo-reconciliation-run-manifest")!.sha256,
      },
    ],
    [
      "authoring-dataset-manifest",
      {
        role: "authoring-dataset-manifest",
        sha256: inputs.get("authoring-dataset-manifest")?.sha256,
      },
    ],
  ]);
  for (const [kind, filenames] of [
    ["grow", ["source-records.jsonl", "candidates.jsonl"]],
    [
      "cropgraph",
      [
        "selected-records.jsonl",
        "identity-candidates.jsonl",
        "cultivation-candidates.jsonl",
      ],
    ],
  ] as const) {
    for (const filename of filenames) {
      const output = records(
        runs.get(`${kind}-importer-run-manifest`)!.outputs,
      ).find((row) => row.path === filename);
      if (output === undefined)
        throw new Error(`Missing source output ${kind}:${filename}`);
      const role = `${kind}-${filename.replaceAll(".jsonl", "")}`;
      expected.set(role, {
        role,
        sha256: output.sha256,
        ...(output.recordCount === undefined
          ? {}
          : { recordCount: output.recordCount }),
      });
    }
  }
  for (const packet of draft.packets) {
    const dependencies = uniqueBy(records(packet.dependencies), (row) =>
      field(row, "role"),
    );
    if (dependencies.size !== expected.size)
      throw new Error(
        `Packet dependencies are incomplete: ${field(packet, "id")}`,
      );
    for (const [role, value] of expected)
      if (!same(dependencies.get(role) ?? null, value))
        throw new Error(`Packet dependency differs: ${role}`);
  }
}

export function currentRecords(
  values: readonly RecordValue[],
  supersessionField = "supersedesDecisionId",
): RecordValue[] {
  const superseded = new Set(
    values.flatMap((row) =>
      typeof row[supersessionField] === "string"
        ? [row[supersessionField]]
        : [],
    ),
  );
  return values.filter((row) => !superseded.has(field(row, "id")));
}

/** Audit a prospective dataset against frozen candidates without writing it (also reusable by T18). */
export function auditCurationDecisionLineage(
  dataset: ValidationDataset,
  draft: IntegratedReviewDraft,
): void {
  const packets = uniqueBy(draft.packets, (packet) => sourceRecordKey(packet)!);
  const candidates = uniqueBy(
    draft.packets.flatMap((packet) => records(packet.cultivationCandidates)),
    (candidate) => field(candidate, "id"),
  );
  const comparisons = uniqueBy(draft.comparisons, (comparison) =>
    field(comparison, "id"),
  );
  const authoredSnapshot = (collection: string, decision: RecordValue) =>
    draft.packets.some((packet) => {
      const authored = object(packet.authoredDecisions);
      return (
        records(authored[collection] ?? []).some((row) =>
          same(row, decision),
        ) &&
        records(authored.packetDecisions ?? []).some(
          (receipt) =>
            receipt.draftManifestSha256 === decision.draftManifestSha256 &&
            records(receipt.records).some((entry) =>
              same(entry.value, decision),
            ),
        )
      );
    });
  for (const decision of [
    ...currentRecords(dataset.sourceNameDecisions ?? []),
    ...currentRecords(
      dataset.sourceSubjectMappings ?? [],
      "supersedesMappingId",
    ),
  ]) {
    if (!packets.has(sourceRecordKey(decision) ?? ""))
      throw new Error(
        `Decision source is outside draft scope: ${field(decision, "id")}`,
      );
    const packet = packets.get(sourceRecordKey(decision)!)!;
    const locators = new Set([
      String(object(packet.sourceRecord).sourceLocator),
      ...records(packet.taxonomyOutcomes).map((row) =>
        String(object(row.source).sourceLocator),
      ),
    ]);
    if (!locators.has(String(decision.sourceLocator)))
      throw new Error(
        `Decision source locator differs: ${field(decision, "id")}`,
      );
    if (
      decision.sourceName !== undefined &&
      !records(packet.taxonomyOutcomes).some(
        (row) => row.sourceName === decision.sourceName,
      )
    )
      throw new Error(`Decision source name differs: ${field(decision, "id")}`);
    if (decision.externalTaxonomyCrosswalkId !== undefined) {
      const crosswalk = (dataset.externalTaxonomyCrosswalks ?? []).find(
        (row) => row.id === decision.externalTaxonomyCrosswalkId,
      );
      if (crosswalk === undefined)
        throw new Error(
          `Missing decision crosswalk ${field(decision, "externalTaxonomyCrosswalkId")}`,
        );
      if (decision.decision === "accept-candidate") {
        const alternatives = records(packet.taxonomyOutcomes)
          .flatMap((row) => records(row.alternatives))
          .flatMap((row) =>
            row.acceptedName === undefined
              ? [row]
              : [row, object(row.acceptedName)],
          );
        if (
          !alternatives.some(
            (row) =>
              same(row.externalIdentifier, crosswalk.externalIdentifier) &&
              row.scientificName === crosswalk.externalName &&
              row.sourceLocator === crosswalk.locator,
          )
        )
          throw new Error(
            `Accepted crosswalk differs from WFO proposal: ${field(decision, "id")}`,
          );
      }
    }
  }
  for (const decision of currentRecords(
    dataset.sourceAssertionDecisions ?? [],
  )) {
    if (
      authoredSnapshot("sourceAssertionDecisions", decision) &&
      decision.draftManifestSha256 !== draft.manifestSha256
    )
      continue;
    const candidate = candidates.get(field(decision, "sourceCandidateId"));
    if (
      candidate === undefined ||
      (sourceRecordKey(decision) !== undefined &&
        sourceRecordKey(candidate) !== sourceRecordKey(decision)) ||
      decision.draftManifestSha256 !== draft.manifestSha256
    )
      throw new Error(
        `Assertion decision lineage differs: ${field(decision, "id")}`,
      );
    if (decision.decision === "accept") {
      const reviews = new Map(
        dataset.reviews.map((row) => [field(row, "id"), row]),
      );
      const subject = currentRecords(
        dataset.sourceSubjectMappings ?? [],
        "supersedesMappingId",
      ).find((row) => sourceRecordKey(row) === sourceRecordKey(candidate));
      if (
        subject === undefined ||
        subject.decision !== "map" ||
        reviews.get(String(subject.reviewId))?.status !== "accepted"
      )
        throw new Error(
          `Accepted assertion lacks reviewed source subject: ${field(decision, "id")}`,
        );
      const assertion = dataset.assertions.find(
        (row) => row.id === decision.assertionId,
      );
      if (assertion === undefined)
        throw new Error(
          `Missing accepted assertion ${String(decision.assertionId)}`,
        );
      if (!same(assertion.subject, subject.subject))
        throw new Error(
          `Accepted assertion subject differs: ${field(decision, "id")}`,
        );
      const evidenceIds = strings(assertion.evidenceReferenceIds);
      const locators =
        typeof candidate.sourceLocator === "string"
          ? [candidate.sourceLocator]
          : strings(candidate.sourceLocators);
      if (
        !dataset.evidence.some(
          (row) =>
            evidenceIds.includes(field(row, "id")) &&
            sourceRecordKey(row) === sourceRecordKey(candidate) &&
            locators.includes(String(row.locator)),
        )
      )
        throw new Error(
          `Accepted assertion lacks candidate provenance: ${field(decision, "id")}`,
        );
      if (candidate.predicate === "calendar_window") {
        const geography = object(object(candidate.applicability).geography);
        const locationKey = sourceLocationKey({
          source: qualifiedSourceRecordKey(candidate)?.source,
          sourceLocation: { sheetCode: geography.sheetCode },
        });
        const locationDecision = currentRecords(
          dataset.sourceGeographyDecisions ?? [],
        ).find(
          (row) =>
            sourceLocationKey(row) === locationKey && locationKey !== undefined,
        );
        if (
          locationDecision === undefined ||
          locationDecision.decision !== "map" ||
          reviews.get(String(locationDecision.reviewId))?.status !== "accepted"
        )
          throw new Error(
            `Accepted calendar assertion lacks reviewed geography: ${field(decision, "id")}`,
          );
      }
    }
  }
  for (const decision of currentRecords(
    dataset.assertionComparisonDecisions ?? [],
  )) {
    if (
      authoredSnapshot("assertionComparisonDecisions", decision) &&
      decision.draftManifestSha256 !== draft.manifestSha256
    )
      continue;
    const comparison = comparisons.get(field(decision, "comparisonId"));
    if (
      comparison === undefined ||
      decision.draftManifestSha256 !== draft.manifestSha256
    )
      throw new Error(
        `Comparison decision lineage differs: ${field(decision, "id")}`,
      );
    if (
      decision.decision === "prefer-assertion" &&
      !records(comparison.candidates).some((candidate) =>
        same(
          {
            candidateId: candidate.candidateId,
            sourceClaimKey: candidate.sourceClaimKey,
          },
          decision.preferredAssertion,
        ),
      )
    )
      throw new Error(
        `Preferred assertion is outside comparison: ${field(decision, "id")}`,
      );
  }
}

function auditAuthoredSnapshots(
  dataset: ValidationDataset,
  draft: IntegratedReviewDraft,
): void {
  for (const packet of draft.packets) {
    const expected = collectAuthoredDecisions(
      dataset,
      sourceRecordKey(packet)!,
      records(packet.taxonomyOutcomes).flatMap(wfoIdentifiersFromCandidate),
      records(packet.localizationOutcomes),
      records(packet.localizationProposals),
      [
        ...records(packet.identityCandidates),
        ...records(packet.cultivationCandidates),
      ].map((row) => field(row, "id")),
    );
    const decisions = (dataset.assertionComparisonDecisions ?? [])
      .filter((row) =>
        strings(packet.comparisonIds).includes(String(row.comparisonId)),
      )
      .sort((a, b) =>
        field(a, "id") < field(b, "id")
          ? -1
          : field(a, "id") > field(b, "id")
            ? 1
            : 0,
      );
    if (decisions.length > 0) expected.assertionComparisonDecisions = decisions;
    if (!same(expected, packet.authoredDecisions))
      throw new Error(
        `Packet authored decision snapshot differs: ${field(packet, "id")}`,
      );
  }
}

export function auditBaselines(
  loaded: LoadedCurationDataset,
  draft: IntegratedReviewDraft,
): void {
  const inputs = records(draft.manifest.inputs);
  for (const baseline of loaded.manifest.reviewBaseline) {
    // The historical GROW/WFO draft baseline is not a pin for integrated drafts.
    if (baseline.role === "draft-manifest") continue;
    if (baseline.type === "configuration") {
      const role = baseline.role.replace(/-configuration$/, "-run-manifest");
      const input = inputs.find((row) => row.role === role);
      if (input === undefined || input.configurationSha256 !== baseline.sha256)
        throw new Error(
          `Review configuration baseline differs: ${baseline.role}`,
        );
    } else {
      const descriptor = [...inputs, ...records(draft.manifest.scopes)].find(
        (row) => row.role === baseline.role,
      );
      if (descriptor === undefined || descriptor.sha256 !== baseline.sha256)
        throw new Error(`Review baseline differs: ${baseline.role}`);
    }
  }
}
