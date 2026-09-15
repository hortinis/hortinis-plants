import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  parseJsonStrict,
  type CanonicalJsonError,
} from "../serialization/canonical-json.js";
import { JsonLinesError, readJsonLines } from "../serialization/json-lines.js";
import {
  validate,
  type ValidationApi,
  type ValidationError,
} from "../schema/validation-api.js";
import {
  validateValidationDataset,
  type DatasetRecord,
  type DatasetValidationIssue,
  type ValidationDataset,
} from "./validation-dataset.js";

type RecordValue = DatasetRecord;
type ManifestRole =
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

interface CollectionDescriptor {
  readonly role: ManifestRole;
  readonly path: string;
  readonly format: "jsonl";
  readonly schemaId: string;
  readonly authority: "curator-authored";
}

interface DependencyDescriptor {
  readonly role: "source-manifest" | "source" | "licence";
  readonly id: string;
  readonly path: string;
  readonly format: "json";
  readonly schemaId: string;
  readonly sha256: string;
  readonly authority: "tracked-source-metadata";
}

interface CurationManifest {
  readonly collections: readonly CollectionDescriptor[];
  readonly dependencies: readonly DependencyDescriptor[];
  readonly reviewBaseline: {
    readonly growImporterConfigurationSha256: string;
    readonly wfoReconciliationConfigurationSha256: string;
    readonly draftManifestSha256: string;
  };
}

interface DraftOutputDescriptor {
  readonly role: string;
  readonly path: string;
  readonly mediaType: "application/jsonl";
  readonly schemaId: string;
  readonly sha256: string;
  readonly byteSize: number;
  readonly recordCount: number;
}

interface DraftManifest {
  readonly inputs: {
    readonly growImporterRun: {
      readonly sha256: string;
      readonly configurationSha256: string;
    };
    readonly wfoReconciliationRun: {
      readonly sha256: string;
      readonly configurationSha256: string;
    };
    readonly growSourceManifest: {
      readonly id: string;
      readonly sha256: string;
    };
    readonly wfoSourceManifest: {
      readonly id: string;
      readonly sha256: string;
    };
    readonly wfoSnapshotSha256: string;
  };
  readonly outputs: readonly DraftOutputDescriptor[];
}

export interface CurationValidationIssue {
  readonly code: string;
  readonly path: string;
  readonly lineNumber?: number;
  readonly recordId?: string;
  readonly message: string;
  readonly validationErrors?: readonly ValidationError[];
}

export interface LoadedCurationDataset {
  readonly manifest: CurationManifest;
  readonly dataset: ValidationDataset;
  readonly locations: ReadonlyMap<string, RecordLocation>;
}

export interface RecordLocation {
  readonly path: string;
  readonly lineNumber: number;
}

export interface GrowWfoValidationOptions {
  readonly repositoryRoot?: string;
  readonly datasetDirectory?: string;
  readonly draftsDirectory?: string;
  readonly growRunDirectory?: string;
  readonly wfoRunDirectory?: string;
  readonly againstDrafts?: boolean;
  readonly validationApi?: ValidationApi;
}

export interface GrowWfoValidationResult {
  readonly valid: boolean;
  readonly issues: readonly CurationValidationIssue[];
  readonly loaded?: LoadedCurationDataset;
}

const manifestSchemaId =
  "urn:hortinis:plants:schema:authoring:v1:curation-dataset-manifest";

const collectionSchemaIds: Readonly<Record<ManifestRole, string>> = {
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

const dependencySchemaIds: Readonly<
  Record<DependencyDescriptor["role"], string>
> = {
  "source-manifest": "urn:hortinis:plants:schema:v1:source-manifest",
  source: "urn:hortinis:plants:schema:v1:source",
  licence: "urn:hortinis:plants:schema:v1:licence",
};

const draftOutputSchemas: Readonly<Record<string, string>> = {
  "identity-review-queue":
    "urn:hortinis:plants:schema:curation:v1:identity-review-item",
  "subject-mapping-review-queue":
    "urn:hortinis:plants:schema:curation:v1:subject-review-item",
  "assertion-review-queue":
    "urn:hortinis:plants:schema:curation:v1:assertion-review-item",
  "taxonomy-crosswalk-review-queue":
    "urn:hortinis:plants:schema:curation:v1:crosswalk-review-item",
  "geographic-context-review-queue":
    "urn:hortinis:plants:schema:curation:v1:geography-review-item",
  "curation-issues":
    "urn:hortinis:plants:schema:curation:v1:curation-issue-review-item",
};

const draftOutputPaths: Readonly<Record<string, string>> = {
  "identity-review-queue": "identity-review-queue.jsonl",
  "subject-mapping-review-queue": "subject-mapping-review-queue.jsonl",
  "assertion-review-queue": "assertion-review-queue.jsonl",
  "taxonomy-crosswalk-review-queue": "taxonomy-crosswalk-review-queue.jsonl",
  "geographic-context-review-queue": "geographic-context-review-queue.jsonl",
  "curation-issues": "curation-issues.jsonl",
};

const roleToDatasetField: Readonly<
  Record<ManifestRole, keyof ValidationDataset>
> = {
  taxa: "taxa",
  "taxonomic-names": "taxonomicNames",
  "plant-concepts": "plantConcepts",
  "cultivar-groups": "cultivarGroups",
  cultivars: "cultivars",
  "localized-names": "localizedNames",
  "geographic-contexts": "geographicContexts",
  "cultivation-contexts": "contexts",
  "evidence-references": "evidence",
  reviews: "reviews",
  "external-taxonomy-crosswalks": "externalTaxonomyCrosswalks",
  "source-name-decisions": "sourceNameDecisions",
  "source-subject-mappings": "sourceSubjectMappings",
  "source-geography-decisions": "sourceGeographyDecisions",
  "source-assertion-decisions": "sourceAssertionDecisions",
  assertions: "assertions",
  "curation-issues": "curationIssues",
};

/** Load and validate the tracked C4 authoring dataset without writing anything. */
export async function validateGrowWfoDataset(
  options: GrowWfoValidationOptions = {},
): Promise<GrowWfoValidationResult> {
  const repositoryRoot = resolve(
    options.repositoryRoot ?? resolve(import.meta.dirname, "../.."),
  );
  const datasetDirectory = resolve(
    options.datasetDirectory ??
      join(repositoryRoot, "data/curation/grow-wfo-initial"),
  );
  const validationApi = options.validationApi ?? { validate };
  const issues: CurationValidationIssue[] = [];
  const manifestPath = join(datasetDirectory, "dataset-manifest.json");
  const manifestValue = await readStrictJsonFile(manifestPath, issues);
  if (manifestValue === undefined) return result(issues);

  const manifestValidation = validateValue(
    validationApi,
    manifestSchemaId,
    manifestValue,
    manifestPath,
    issues,
  );
  if (!manifestValidation) return result(issues);
  const manifest = manifestValue as CurationManifest;
  const datasetRoot = await realPathOr(datasetDirectory, datasetDirectory);
  const collections = manifest.collections;
  const roles = new Set<string>();
  const paths = new Set<string>();
  const recordsByField = new Map<keyof ValidationDataset, RecordValue[]>();
  const locations = new Map<string, RecordLocation>();
  let loadedAllCollections = true;

  for (const descriptor of collections) {
    const path = descriptor.path;
    if (roles.has(descriptor.role)) {
      addIssue(
        issues,
        "DUPLICATE_COLLECTION_ROLE",
        join(manifestPath),
        `Collection role ${descriptor.role} is declared more than once`,
      );
      loadedAllCollections = false;
      continue;
    }
    roles.add(descriptor.role);
    if (paths.has(path)) {
      addIssue(
        issues,
        "DUPLICATE_COLLECTION_PATH",
        join(manifestPath),
        `Collection path ${path} is declared more than once`,
      );
      loadedAllCollections = false;
      continue;
    }
    paths.add(path);
    const expectedSchemaId = collectionSchemaIds[descriptor.role];
    if (descriptor.schemaId !== expectedSchemaId) {
      if (
        !schemaIsKnown(validationApi, descriptor.schemaId, manifestPath, issues)
      ) {
        loadedAllCollections = false;
        continue;
      }
      addIssue(
        issues,
        "SCHEMA_ROLE_MISMATCH",
        manifestPath,
        `Collection ${descriptor.role} must use schema ${expectedSchemaId}`,
      );
      loadedAllCollections = false;
      continue;
    }
    const collectionPath = await safePath(
      datasetRoot,
      path,
      manifestPath,
      "collection",
      issues,
    );
    if (collectionPath === undefined) {
      loadedAllCollections = false;
      continue;
    }
    const records: RecordValue[] = [];
    recordsByField.set(roleToDatasetField[descriptor.role], records);
    try {
      for await (const entry of readJsonLines(
        createReadStream(collectionPath),
        {
          schemaId: descriptor.schemaId,
          validationApi,
        },
      )) {
        if (!isRecord(entry.value)) {
          addIssue(
            issues,
            "NON_OBJECT_RECORD",
            path,
            `JSON Lines record must be an object`,
            entry.lineNumber,
          );
          loadedAllCollections = false;
          continue;
        }
        records.push(entry.value);
        const id =
          typeof entry.value.id === "string" ? entry.value.id : undefined;
        if (id !== undefined && !locations.has(id)) {
          locations.set(id, { path, lineNumber: entry.lineNumber });
        }
      }
    } catch (error) {
      loadedAllCollections = false;
      addJsonLinesIssue(issues, path, error);
    }
  }

  const dependencyRecords = await loadDependencies(
    manifest,
    repositoryRoot,
    validationApi,
    issues,
  );
  if (dependencyRecords === undefined) loadedAllCollections = false;

  let loaded: LoadedCurationDataset | undefined;
  if (loadedAllCollections && dependencyRecords !== undefined) {
    const dataset: ValidationDataset = {
      taxa: recordsByField.get("taxa") ?? [],
      taxonomicNames: recordsByField.get("taxonomicNames") ?? [],
      plantConcepts: recordsByField.get("plantConcepts") ?? [],
      cultivarGroups: recordsByField.get("cultivarGroups") ?? [],
      cultivars: recordsByField.get("cultivars") ?? [],
      localizedNames: recordsByField.get("localizedNames") ?? [],
      geographicContexts: recordsByField.get("geographicContexts") ?? [],
      contexts: recordsByField.get("contexts") ?? [],
      rules: [],
      evidence: recordsByField.get("evidence") ?? [],
      reviews: recordsByField.get("reviews") ?? [],
      assertions: recordsByField.get("assertions") ?? [],
      curationIssues: recordsByField.get("curationIssues") ?? [],
      externalTaxonomyCrosswalks:
        recordsByField.get("externalTaxonomyCrosswalks") ?? [],
      sourceNameDecisions: recordsByField.get("sourceNameDecisions") ?? [],
      sourceSubjectMappings: recordsByField.get("sourceSubjectMappings") ?? [],
      sourceGeographyDecisions:
        recordsByField.get("sourceGeographyDecisions") ?? [],
      sourceAssertionDecisions:
        recordsByField.get("sourceAssertionDecisions") ?? [],
      sources: dependencyRecords.sources,
      licences: dependencyRecords.licences,
      sourceManifestIds: dependencyRecords.sourceManifestIds,
    };
    for (const issue of validateValidationDataset(dataset)) {
      addSemanticIssue(issues, issue, locations);
    }
    loaded = { manifest, dataset, locations };
  }

  if (options.againstDrafts) {
    await auditDrafts(manifest, repositoryRoot, validationApi, options, issues);
    if (loaded !== undefined) {
      await auditAuthoringLineage(
        loaded.dataset,
        repositoryRoot,
        options,
        issues,
      );
    }
  }
  return result(issues, loaded);
}

async function loadDependencies(
  manifest: CurationManifest,
  repositoryRoot: string,
  validationApi: ValidationApi,
  issues: CurationValidationIssue[],
): Promise<
  | {
      readonly sources: readonly RecordValue[];
      readonly licences: readonly RecordValue[];
      readonly sourceManifestIds: readonly string[];
    }
  | undefined
> {
  const sources: RecordValue[] = [];
  const licences: RecordValue[] = [];
  const sourceManifestIds: string[] = [];
  const ids = new Set<string>();
  const paths = new Set<string>();
  let valid = true;
  const root = await realPathOr(repositoryRoot, repositoryRoot);
  for (const dependency of manifest.dependencies) {
    if (ids.has(dependency.id)) {
      addIssue(
        issues,
        "DUPLICATE_DEPENDENCY_ID",
        "dataset-manifest.json",
        `Dependency identifier ${dependency.id} is declared more than once`,
      );
      valid = false;
    }
    ids.add(dependency.id);
    if (paths.has(dependency.path)) {
      addIssue(
        issues,
        "DUPLICATE_DEPENDENCY_PATH",
        "dataset-manifest.json",
        `Dependency path ${dependency.path} is declared more than once`,
      );
      valid = false;
    }
    paths.add(dependency.path);
    const expectedSchemaId = dependencySchemaIds[dependency.role];
    if (dependency.schemaId !== expectedSchemaId) {
      if (
        !schemaIsKnown(
          validationApi,
          dependency.schemaId,
          "dataset-manifest.json",
          issues,
        )
      ) {
        valid = false;
        continue;
      }
      addIssue(
        issues,
        "SCHEMA_ROLE_MISMATCH",
        "dataset-manifest.json",
        `Dependency ${dependency.role} must use schema ${expectedSchemaId}`,
      );
      valid = false;
      continue;
    }
    const dependencyPath = await safePath(
      root,
      dependency.path,
      "dataset-manifest.json",
      "dependency",
      issues,
    );
    if (dependencyPath === undefined) {
      valid = false;
      continue;
    }
    let bytes: Buffer;
    try {
      bytes = await readFile(dependencyPath);
    } catch (error) {
      addIssue(
        issues,
        "MISSING_DEPENDENCY",
        dependency.path,
        `Unable to read dependency ${dependency.path}: ${errorMessage(error)}`,
      );
      valid = false;
      continue;
    }
    const actualHash = sha256(bytes);
    if (actualHash !== dependency.sha256) {
      addIssue(
        issues,
        "DEPENDENCY_CHECKSUM_MISMATCH",
        dependency.path,
        `Dependency checksum ${actualHash} does not match ${dependency.sha256}`,
      );
      valid = false;
    }
    const value = parseStrict(bytes, dependency.path, issues);
    if (value === undefined) {
      valid = false;
      continue;
    }
    if (
      !validateValue(
        validationApi,
        dependency.schemaId,
        value,
        dependency.path,
        issues,
      )
    ) {
      valid = false;
      continue;
    }
    if (!isRecord(value) || value.id !== dependency.id) {
      addIssue(
        issues,
        "DEPENDENCY_ID_MISMATCH",
        dependency.path,
        `Dependency declares id ${
          isRecord(value)
            ? typeof value.id === "string"
              ? value.id
              : "<missing>"
            : "<non-object>"
        }, expected ${dependency.id}`,
      );
      valid = false;
      continue;
    }
    if (dependency.role === "source") sources.push(value);
    else if (dependency.role === "licence") licences.push(value);
    else sourceManifestIds.push(dependency.id);
  }
  return valid
    ? { sources, licences, sourceManifestIds: sourceManifestIds.sort() }
    : undefined;
}

async function auditDrafts(
  manifest: CurationManifest,
  repositoryRoot: string,
  validationApi: ValidationApi,
  options: GrowWfoValidationOptions,
  issues: CurationValidationIssue[],
): Promise<void> {
  const draftsDirectory = resolve(
    options.draftsDirectory ??
      join(repositoryRoot, ".cache/curation-drafts/grow-wfo/latest"),
  );
  const draftManifestPath = join(draftsDirectory, "draft-manifest.json");
  const draftBytes = await readFileOrIssue(
    draftManifestPath,
    issues,
    "MISSING_DRAFT",
  );
  if (draftBytes === undefined) return;
  const draftValue = parseStrict(draftBytes, draftManifestPath, issues);
  if (draftValue === undefined) return;
  if (
    !validateValue(
      validationApi,
      "urn:hortinis:plants:schema:curation:v1:draft-manifest",
      draftValue,
      draftManifestPath,
      issues,
    )
  )
    return;
  const draft = draftValue as DraftManifest;
  const baseline = manifest.reviewBaseline;
  const draftHash = sha256(draftBytes);
  if (draftHash !== baseline.draftManifestSha256) {
    addIssue(
      issues,
      "DRAFT_MANIFEST_DRIFT",
      draftManifestPath,
      `Draft manifest checksum ${draftHash} does not match ${baseline.draftManifestSha256}`,
    );
  }
  const outputRoles = new Set<string>();
  for (const output of draft.outputs) {
    if (outputRoles.has(output.role)) {
      addIssue(
        issues,
        "DUPLICATE_DRAFT_OUTPUT_ROLE",
        draftManifestPath,
        `Draft output role ${output.role} is declared more than once`,
      );
      continue;
    }
    outputRoles.add(output.role);
    const expectedSchemaId = draftOutputSchemas[output.role];
    const expectedPath = draftOutputPaths[output.role];
    if (expectedSchemaId === undefined || expectedPath === undefined) {
      addIssue(
        issues,
        "UNKNOWN_DRAFT_OUTPUT_ROLE",
        draftManifestPath,
        `Unknown draft output role ${output.role}`,
      );
      continue;
    }
    if (output.path !== expectedPath || output.schemaId !== expectedSchemaId) {
      addIssue(
        issues,
        "DRAFT_OUTPUT_DESCRIPTOR_MISMATCH",
        draftManifestPath,
        `Draft output ${output.role} must declare ${expectedPath} and ${expectedSchemaId}`,
      );
    }
    const path = await safePath(
      draftsDirectory,
      output.path,
      draftManifestPath,
      "draft output",
      issues,
    );
    if (path === undefined) continue;
    const bytes = await readFileOrIssue(path, issues, "MISSING_DRAFT_OUTPUT");
    if (bytes === undefined) continue;
    if (
      sha256(bytes) !== output.sha256 ||
      bytes.byteLength !== output.byteSize
    ) {
      addIssue(
        issues,
        "DRAFT_OUTPUT_CHECKSUM_MISMATCH",
        output.path,
        `Draft output checksum or byte size does not match its descriptor`,
      );
    }
    let count = 0;
    try {
      for await (const entry of readJsonLines(createReadStream(path), {
        schemaId: output.schemaId,
        validationApi,
      }))
        count = entry.lineNumber;
    } catch (error) {
      addJsonLinesIssue(issues, output.path, error);
      continue;
    }
    if (count !== output.recordCount) {
      addIssue(
        issues,
        "DRAFT_OUTPUT_COUNT_MISMATCH",
        output.path,
        `Draft output contains ${count} records, descriptor declares ${output.recordCount}`,
      );
    }
  }
  for (const role of Object.keys(draftOutputSchemas)) {
    if (!outputRoles.has(role))
      addIssue(
        issues,
        "MISSING_DRAFT_OUTPUT",
        draftManifestPath,
        `Draft manifest does not declare output ${role}`,
      );
  }

  const dependencyByRole = new Map(
    manifest.dependencies.map((dependency) => [
      dependency.role + ":" + dependency.id,
      dependency,
    ]),
  );
  for (const input of [
    draft.inputs.growSourceManifest,
    draft.inputs.wfoSourceManifest,
  ]) {
    const dependency = dependencyByRole.get("source-manifest:" + input.id);
    if (dependency === undefined || dependency.sha256 !== input.sha256) {
      addIssue(
        issues,
        "DRAFT_SOURCE_MANIFEST_DRIFT",
        draftManifestPath,
        `Draft source manifest ${input.id} is not the tracked dependency`,
      );
    }
  }
  if (
    draft.inputs.growImporterRun.configurationSha256 !==
    baseline.growImporterConfigurationSha256
  ) {
    addIssue(
      issues,
      "DRAFT_CONFIGURATION_DRIFT",
      draftManifestPath,
      "GROW importer configuration differs from the tracked review baseline",
    );
  }
  if (
    draft.inputs.wfoReconciliationRun.configurationSha256 !==
    baseline.wfoReconciliationConfigurationSha256
  ) {
    addIssue(
      issues,
      "DRAFT_CONFIGURATION_DRIFT",
      draftManifestPath,
      "WFO reconciliation configuration differs from the tracked review baseline",
    );
  }
  await auditRun(
    join(
      options.growRunDirectory ??
        join(repositoryRoot, ".cache/import-runs/grow/latest"),
      "importer-run-manifest.json",
    ),
    draft.inputs.growImporterRun.sha256,
    "urn:hortinis:plants:schema:v1:importer-run-manifest",
    validationApi,
    issues,
  );
  await auditRun(
    join(
      options.wfoRunDirectory ??
        join(repositoryRoot, ".cache/import-runs/wfo/latest"),
      "reconciliation-run-manifest.json",
    ),
    draft.inputs.wfoReconciliationRun.sha256,
    "urn:hortinis:plants:schema:v1:taxonomy-reconciliation-manifest",
    validationApi,
    issues,
  );
  const snapshotPath = join(
    repositoryRoot,
    ".cache/source-inputs/wfo/2026-06/_DwC_backbone_R.zip",
  );
  try {
    const snapshotHash = await hashFile(snapshotPath);
    if (snapshotHash !== draft.inputs.wfoSnapshotSha256) {
      addIssue(
        issues,
        "WFO_SNAPSHOT_DRIFT",
        snapshotPath,
        `Current WFO snapshot checksum ${snapshotHash} does not match the draft input`,
      );
    }
  } catch (error) {
    addIssue(
      issues,
      "MISSING_SOURCE_INPUT",
      snapshotPath,
      `Unable to read ${snapshotPath}: ${errorMessage(error)}`,
    );
  }
}

async function auditAuthoringLineage(
  dataset: ValidationDataset,
  repositoryRoot: string,
  options: GrowWfoValidationOptions,
  issues: CurationValidationIssue[],
): Promise<void> {
  const draftsDirectory = resolve(
    options.draftsDirectory ??
      join(repositoryRoot, ".cache/curation-drafts/grow-wfo/latest"),
  );
  const draftManifestPath = join(draftsDirectory, "draft-manifest.json");
  const draftManifestBytes = await readFileOrIssue(
    draftManifestPath,
    issues,
    "MISSING_DRAFT",
  );
  if (draftManifestBytes === undefined) return;
  const candidateById = new Map<string, RecordValue>();
  const assertionQueuePath = join(
    draftsDirectory,
    "assertion-review-queue.jsonl",
  );
  try {
    for await (const entry of readJsonLines(
      createReadStream(assertionQueuePath),
    )) {
      const item = asRecord(entry.value);
      const candidate = asRecord(item?.sourceCandidate);
      const candidateId = stringField(candidate, "id");
      if (candidate !== undefined && candidateId !== undefined)
        candidateById.set(candidateId, candidate);
    }
  } catch (error) {
    addJsonLinesIssue(issues, assertionQueuePath, error);
    return;
  }
  const draftHash = sha256(draftManifestBytes);
  const reviews = new Map(
    dataset.reviews.map((review) => [stringField(review, "id"), review]),
  );
  const subjects = currentDecisionBySourceRecord(
    dataset.sourceSubjectMappings ?? [],
    "supersedesMappingId",
  );
  const geographies = currentDecisionByLocation(
    dataset.sourceGeographyDecisions ?? [],
  );
  const assertions = currentDecisionByCandidate(
    dataset.sourceAssertionDecisions ?? [],
  );
  for (const decision of assertions.values()) {
    const id = recordId(decision);
    if (stringField(decision, "draftManifestSha256") !== draftHash) {
      addIssue(
        issues,
        "CANDIDATE_LINEAGE",
        "source-assertion-decisions.jsonl",
        `Assertion decision ${id} does not reference the tracked draft manifest`,
        undefined,
        id,
      );
    }
    const candidateId = stringField(decision, "sourceCandidateId");
    const candidate =
      candidateId === undefined ? undefined : candidateById.get(candidateId);
    if (candidate === undefined) {
      addIssue(
        issues,
        "CANDIDATE_LINEAGE",
        "source-assertion-decisions.jsonl",
        `Assertion decision ${id} references missing draft candidate ${candidateId ?? "<missing>"}`,
        undefined,
        id,
      );
      continue;
    }
    if (stringField(decision, "decision") !== "accept") continue;
    const sourceRecordId = stringField(candidate, "sourceRecordId");
    const subject =
      sourceRecordId === undefined ? undefined : subjects.get(sourceRecordId);
    if (
      subject === undefined ||
      stringField(subject, "decision") !== "map" ||
      !reviewIsAccepted(subject, reviews)
    ) {
      addIssue(
        issues,
        "CANDIDATE_LINEAGE",
        "source-assertion-decisions.jsonl",
        `Accepted assertion decision ${id} requires a current reviewed subject mapping for source record ${sourceRecordId ?? "<missing>"}`,
        undefined,
        id,
      );
    }
    const assertionId = stringField(decision, "assertionId");
    const assertion = dataset.assertions.find(
      (candidateAssertion) =>
        stringField(candidateAssertion, "id") === assertionId,
    );
    if (assertion === undefined) continue;
    const evidence = dataset.evidence.filter((reference) =>
      stringArray(assertion.evidenceReferenceIds).includes(
        stringField(reference, "id") ?? "",
      ),
    );
    const source = {
      sourceId: stringField(candidate, "sourceId"),
      sourceManifestId: stringField(candidate, "sourceManifestId"),
      sourceReleaseId: stringField(candidate, "sourceReleaseId"),
      sourceRecordId: stringField(candidate, "sourceRecordId"),
      locator: stringField(candidate, "sourceLocator"),
    };
    if (
      !evidence.some(
        (reference) =>
          source.sourceId === stringField(reference, "sourceId") &&
          source.sourceManifestId ===
            stringField(reference, "sourceManifestId") &&
          source.sourceReleaseId ===
            stringField(reference, "sourceReleaseId") &&
          source.sourceRecordId === stringField(reference, "sourceRecordId") &&
          source.locator === stringField(reference, "locator"),
      )
    ) {
      addIssue(
        issues,
        "CANDIDATE_LINEAGE",
        "assertions.jsonl",
        `Accepted assertion ${assertionId ?? "<missing>"} has no evidence for candidate ${candidateId}`,
        undefined,
        assertionId,
      );
    }
    if (stringField(candidate, "predicate") === "calendar_window") {
      const geography = asRecord(asRecord(candidate.applicability)?.geography);
      const geographyKey = tupleKey([
        stringField(candidate, "sourceId"),
        stringField(candidate, "sourceManifestId"),
        stringField(candidate, "sourceReleaseId"),
        stringField(geography, "sheetCode"),
      ]);
      const geographyDecision =
        geographyKey === undefined ? undefined : geographies.get(geographyKey);
      if (
        geographyDecision === undefined ||
        stringField(geographyDecision, "decision") !== "map" ||
        !reviewIsAccepted(geographyDecision, reviews)
      ) {
        addIssue(
          issues,
          "CANDIDATE_LINEAGE",
          "source-assertion-decisions.jsonl",
          `Accepted calendar assertion decision ${id} requires a current reviewed geography decision`,
          undefined,
          id,
        );
      }
    }
  }
}

function currentDecisionBySourceRecord(
  records: readonly RecordValue[],
  supersessionField: string,
): Map<string, RecordValue> {
  const superseded = new Set(
    records
      .map((record) => stringField(record, supersessionField))
      .filter((id): id is string => id !== undefined),
  );
  const result = new Map<string, RecordValue>();
  for (const record of records) {
    const sourceRecordId = stringField(record, "sourceRecordId");
    const id = stringField(record, "id");
    if (sourceRecordId !== undefined && id !== undefined && !superseded.has(id))
      result.set(sourceRecordId, record);
  }
  return result;
}

function currentDecisionByLocation(
  records: readonly RecordValue[],
): Map<string, RecordValue> {
  const superseded = new Set(
    records
      .map((record) => stringField(record, "supersedesDecisionId"))
      .filter((id): id is string => id !== undefined),
  );
  const result = new Map<string, RecordValue>();
  for (const record of records) {
    const key = sourceLocationKey(record);
    const id = stringField(record, "id");
    if (key !== undefined && id !== undefined && !superseded.has(id))
      result.set(key, record);
  }
  return result;
}

function currentDecisionByCandidate(
  records: readonly RecordValue[],
): Map<string, RecordValue> {
  const superseded = new Set(
    records
      .map((record) => stringField(record, "supersedesDecisionId"))
      .filter((id): id is string => id !== undefined),
  );
  const result = new Map<string, RecordValue>();
  for (const record of records) {
    const candidateId = stringField(record, "sourceCandidateId");
    const id = stringField(record, "id");
    if (candidateId !== undefined && id !== undefined && !superseded.has(id))
      result.set(candidateId, record);
  }
  return result;
}

function reviewIsAccepted(
  record: RecordValue,
  reviews: ReadonlyMap<string | undefined, RecordValue>,
): boolean {
  return (
    stringField(reviews.get(stringField(record, "reviewId")), "status") ===
    "accepted"
  );
}

function sourceLocationKey(record: RecordValue): string | undefined {
  const location = asRecord(record.sourceLocation);
  return tupleKey([
    stringField(record, "sourceId"),
    stringField(record, "sourceManifestId"),
    stringField(record, "sourceReleaseId"),
    stringField(location, "sheetCode"),
  ]);
}

function tupleKey(values: readonly (string | undefined)[]): string | undefined {
  return values.every((value) => value !== undefined)
    ? values.join("\u0000")
    : undefined;
}

async function auditRun(
  path: string,
  expected: string,
  schemaId: string,
  validationApi: ValidationApi,
  issues: CurationValidationIssue[],
): Promise<void> {
  const bytes = await readFileOrIssue(path, issues, "MISSING_SOURCE_RUN");
  if (bytes === undefined) return;
  if (sha256(bytes) !== expected) {
    addIssue(
      issues,
      "SOURCE_RUN_DRIFT",
      path,
      "Current source run manifest differs from the run used for the draft",
    );
    return;
  }
  const value = parseStrict(bytes, path, issues);
  if (
    value === undefined ||
    !validateValue(validationApi, schemaId, value, path, issues)
  )
    return;
  if (!isRecord(value) || !Array.isArray(value.outputs)) return;
  const runDirectory = resolve(path, "..");
  const seen = new Set<string>();
  for (const descriptorValue of value.outputs) {
    if (!isRecord(descriptorValue)) continue;
    const outputPath =
      typeof descriptorValue.path === "string"
        ? descriptorValue.path
        : undefined;
    const outputSchemaId =
      typeof descriptorValue.schemaId === "string"
        ? descriptorValue.schemaId
        : undefined;
    if (
      outputPath === undefined ||
      outputSchemaId === undefined ||
      !isSafeRelativePath(outputPath) ||
      seen.has(outputPath)
    )
      continue;
    seen.add(outputPath);
    const output = await safePath(
      runDirectory,
      outputPath,
      path,
      "source run output",
      issues,
    );
    if (output === undefined) continue;
    const outputBytes = await readFileOrIssue(
      output,
      issues,
      "MISSING_SOURCE_OUTPUT",
    );
    if (outputBytes === undefined) continue;
    const declaredHash =
      typeof descriptorValue.sha256 === "string"
        ? descriptorValue.sha256
        : undefined;
    const declaredSize =
      typeof descriptorValue.byteSize === "number"
        ? descriptorValue.byteSize
        : undefined;
    if (
      declaredHash !== sha256(outputBytes) ||
      declaredSize !== outputBytes.byteLength
    ) {
      addIssue(
        issues,
        "SOURCE_OUTPUT_DRIFT",
        outputPath,
        "Source run output checksum or byte size differs from its run manifest",
      );
    }
    let count = 0;
    try {
      for await (const entry of readJsonLines(createReadStream(output), {
        schemaId: outputSchemaId,
        validationApi,
      }))
        count = entry.lineNumber;
    } catch (error) {
      addJsonLinesIssue(issues, outputPath, error);
      continue;
    }
    if (
      typeof descriptorValue.recordCount === "number" &&
      count !== descriptorValue.recordCount
    ) {
      addIssue(
        issues,
        "SOURCE_OUTPUT_DRIFT",
        outputPath,
        `Source run output contains ${count} records, manifest declares ${descriptorValue.recordCount}`,
      );
    }
  }
}

async function readStrictJsonFile(
  path: string,
  issues: CurationValidationIssue[],
): Promise<unknown> {
  const bytes = await readFileOrIssue(path, issues, "MISSING_MANIFEST");
  return bytes === undefined ? undefined : parseStrict(bytes, path, issues);
}

async function readFileOrIssue(
  path: string,
  issues: CurationValidationIssue[],
  code: string,
): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch (error) {
    addIssue(
      issues,
      code,
      path,
      `Unable to read ${path}: ${errorMessage(error)}`,
    );
    return undefined;
  }
}

function parseStrict(
  bytes: Uint8Array,
  path: string,
  issues: CurationValidationIssue[],
): unknown {
  try {
    return parseJsonStrict(bytes);
  } catch (error) {
    const canonical = error as Partial<CanonicalJsonError>;
    addIssue(
      issues,
      canonical.code === "DUPLICATE_KEY" ? "DUPLICATE_KEY" : "INVALID_JSON",
      path,
      canonical.message ?? `Invalid JSON in ${path}`,
    );
    return undefined;
  }
}

function validateValue(
  api: ValidationApi,
  schemaId: string,
  value: unknown,
  path: string,
  issues: CurationValidationIssue[],
): boolean {
  try {
    const validation = api.validate(schemaId, value);
    if (validation.valid) return true;
    addIssue(
      issues,
      "SCHEMA_VALIDATION_FAILED",
      path,
      `Value failed schema ${schemaId}`,
      undefined,
      undefined,
      validation.errors,
    );
    return false;
  } catch (error) {
    addIssue(issues, "UNKNOWN_SCHEMA_ID", path, errorMessage(error));
    return false;
  }
}

function schemaIsKnown(
  api: ValidationApi,
  schemaId: string,
  path: string,
  issues: CurationValidationIssue[],
): boolean {
  try {
    api.validate(schemaId, null);
    return true;
  } catch (error) {
    addIssue(issues, "UNKNOWN_SCHEMA_ID", path, errorMessage(error));
    return false;
  }
}

async function safePath(
  root: string,
  path: string,
  issuePath: string,
  kind: string,
  issues: CurationValidationIssue[],
): Promise<string | undefined> {
  if (!isSafeRelativePath(path)) {
    addIssue(
      issues,
      "UNSAFE_PATH",
      issuePath,
      `${kind} path ${path} is not a safe relative path`,
    );
    return undefined;
  }
  const resolvedPath = resolve(root, path);
  const rootRelative = relative(root, resolvedPath);
  if (
    rootRelative === "" ||
    rootRelative.startsWith("..") ||
    isAbsolute(rootRelative)
  ) {
    addIssue(
      issues,
      "UNSAFE_PATH",
      issuePath,
      `${kind} path ${path} escapes its root`,
    );
    return undefined;
  }
  try {
    const realRoot = await realpath(root);
    const realFile = await realpath(resolvedPath);
    const realRelative = relative(realRoot, realFile);
    if (realRelative.startsWith("..") || isAbsolute(realRelative)) {
      addIssue(
        issues,
        "UNSAFE_PATH",
        issuePath,
        `${kind} path ${path} resolves outside its root`,
      );
      return undefined;
    }
  } catch (error) {
    addIssue(
      issues,
      "MISSING_FILE",
      resolvedPath,
      `Unable to access ${resolvedPath}: ${errorMessage(error)}`,
    );
    return undefined;
  }
  return resolvedPath;
}

async function realPathOr(path: string, fallback: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return fallback;
  }
}

function addJsonLinesIssue(
  issues: CurationValidationIssue[],
  path: string,
  error: unknown,
): void {
  if (error instanceof JsonLinesError) {
    addIssue(
      issues,
      error.code,
      path,
      error.message,
      error.lineNumber,
      undefined,
      error.validationErrors,
    );
    return;
  }
  addIssue(issues, "JSON_LINES_READ_FAILED", path, errorMessage(error));
}

function addSemanticIssue(
  issues: CurationValidationIssue[],
  issue: DatasetValidationIssue,
  locations: ReadonlyMap<string, RecordLocation>,
): void {
  const location = locations.get(issue.recordId);
  addIssue(
    issues,
    issue.code,
    location?.path ?? "<semantic>",
    issue.message,
    location?.lineNumber,
    issue.recordId,
  );
}

function addIssue(
  issues: CurationValidationIssue[],
  code: string,
  path: string,
  message: string,
  lineNumber?: number,
  recordId?: string,
  validationErrors?: readonly ValidationError[],
): void {
  issues.push({
    code,
    path,
    message,
    ...(lineNumber === undefined ? {} : { lineNumber }),
    ...(recordId === undefined ? {} : { recordId }),
    ...(validationErrors === undefined ? {} : { validationErrors }),
  });
}

function result(
  issues: CurationValidationIssue[],
  loaded?: LoadedCurationDataset,
): GrowWfoValidationResult {
  const sorted = [...issues].sort(compareIssues);
  return {
    valid: sorted.length === 0,
    issues: sorted,
    ...(loaded === undefined ? {} : { loaded }),
  };
}

function compareIssues(
  left: CurationValidationIssue,
  right: CurationValidationIssue,
): number {
  for (const [a, b] of [
    [left.path, right.path],
    [String(left.lineNumber ?? 0), String(right.lineNumber ?? 0)],
    [left.code, right.code],
    [left.recordId ?? "", right.recordId ?? ""],
    [left.message, right.message],
  ] as const) {
    if (a < b) return -1;
    if (a > b) return 1;
  }
  return 0;
}

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): RecordValue | undefined {
  return isRecord(value) ? value : undefined;
}

function stringField(
  record: RecordValue | undefined,
  field: string,
): string | undefined {
  const value = record?.[field];
  return typeof value === "string" ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function recordId(record: RecordValue): string {
  return stringField(record, "id") ?? "<missing>";
}

function isSafeRelativePath(path: string): boolean {
  return (
    path.length > 0 &&
    !isAbsolute(path) &&
    !path.includes("\\") &&
    path
      .split("/")
      .every((part) => part.length > 0 && part !== "." && part !== "..")
  );
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path))
    hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
