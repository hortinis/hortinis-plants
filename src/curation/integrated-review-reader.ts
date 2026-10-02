import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { sourceRecordKey } from "../domain/source-keys.js";
import type { ValidationApi } from "../schema/validation-api.js";
import {
  CURATION_SCHEMA,
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

export interface IntegratedReviewDraft {
  readonly manifest: RecordValue;
  readonly manifestSha256: string;
  readonly scope: RecordValue;
  readonly packets: readonly RecordValue[];
  readonly queue: readonly RecordValue[];
  readonly comparisons: readonly RecordValue[];
}

const artifacts = [
  ["scopes", "integrated-review-scope", "integrated-review-scope", "json"],
  ["packets", "integrated-review-packets", "integrated-review-packet", "jsonl"],
  [
    "queues",
    "integrated-review-queue",
    "integrated-review-queue-item",
    "jsonl",
  ],
  ["outputs", "assertion-comparisons", "assertion-comparison", "jsonl"],
] as const;

/** Validate a frozen draft without consulting ignored source archives. */
export async function readIntegratedReviewDraft(options: {
  readonly directory: string;
  readonly validationApi: ValidationApi;
  readonly scopePath?: string;
}): Promise<IntegratedReviewDraft> {
  const { directory, validationApi: api } = options;
  const manifestPath = join(directory, "draft-manifest.json");
  const manifest = await readObject(
    manifestPath,
    api,
    CURATION_SCHEMA + "draft-manifest",
  );
  if (manifest.kind !== "integrated-review-drafts")
    throw new Error(`Expected integrated-review-drafts at ${manifestPath}`);
  uniqueBy(records(manifest.inputs), (input) => field(input, "role"));
  uniqueBy(records(manifest.inputs), (input) => field(input, "locator"));
  const roles = new Set<string>();
  const paths = new Set<string>();
  const loaded = new Map<string, RecordValue[]>();
  for (const [collection, role, schema, format] of artifacts) {
    const descriptors = records(manifest[collection]);
    if (descriptors.length !== 1 || descriptors[0]?.role !== role)
      throw new Error(`Draft must declare exactly one ${role} artifact`);
    const descriptor = descriptors[0];
    const path = field(descriptor, "path");
    if (roles.has(role) || paths.has(path))
      throw new Error(`Duplicate draft artifact ${role}: ${path}`);
    roles.add(role);
    paths.add(path);
    if (descriptor.schemaId !== CURATION_SCHEMA + schema)
      throw new Error(`Wrong schema for ${role}`);
    const artifactPath = await containedPath(directory, path);
    loaded.set(
      role,
      await verifyArtifact(artifactPath, descriptor, api, format, true),
    );
    if (collection === "scopes" && options.scopePath !== undefined)
      await verifyArtifact(options.scopePath, descriptor, api, "json");
  }
  const scope = loaded.get("integrated-review-scope")![0]!;
  const packets = loaded.get("integrated-review-packets")!;
  const queue = loaded.get("integrated-review-queue")!;
  const comparisons = loaded.get("assertion-comparisons")!;
  const draft = {
    manifest,
    manifestSha256: digest(await readFile(manifestPath)),
    scope,
    packets,
    queue,
    comparisons,
  };
  auditMembership(draft, api);
  return draft;
}

function requiredKey(record: RecordValue): string {
  const key =
    sourceRecordKey(record) ??
    (record.source === undefined ? undefined : sourceRecordKey(record.source));
  if (key === undefined) throw new Error("Record has no qualified source key");
  return key;
}

function auditMembership(
  draft: IntegratedReviewDraft,
  api: ValidationApi,
): void {
  const { manifest, scope, packets, queue, comparisons } = draft;
  const packetById = uniqueBy(packets, (packet) => field(packet, "id"));
  uniqueBy(packets, requiredKey);
  uniqueBy(queue, (item) => field(item, "id"));
  const queueByPacket = uniqueBy(queue, (item) => field(item, "packetId"));
  const comparisonById = uniqueBy(comparisons, (item) => field(item, "id"));
  const scopeSources = uniqueBy(records(scope.sources), (item) =>
    field(item, "kind"),
  );
  const fingerprints = uniqueBy(records(scope.fingerprints), (item) =>
    field(item, "role"),
  );
  const counts = uniqueBy(records(scope.counts), (item) => field(item, "role"));
  uniqueBy(records(manifest.counts), (item) => field(item, "role"));
  if (!same(scope.counts, manifest.counts))
    throw new Error("Scope and draft counts disagree");
  for (const input of records(manifest.inputs)) {
    const fingerprint = fingerprints.get(field(input, "role"));
    if (
      fingerprint === undefined ||
      fingerprint.sha256 !== input.sha256 ||
      fingerprint.byteSize !== input.byteSize ||
      fingerprint.recordCount !== input.recordCount
    )
      throw new Error(`Scope fingerprint differs for ${input.role as string}`);
  }
  if (queue.length !== packets.length)
    throw new Error("Queue does not account for every packet");
  const candidates = new Map<
    string,
    { claim: RecordValue; packet: RecordValue }
  >();
  for (const packet of packets) {
    const { contentSha256, ...content } = packet;
    if (contentSha256 !== contentDigest(content))
      throw new Error(`Packet content digest differs: ${field(packet, "id")}`);
    const key = requiredKey(packet);
    if (requiredKey(object(packet.sourceRecord)) !== key)
      throw new Error(
        `Packet source-record key differs: ${field(packet, "id")}`,
      );
    const source = scopeSources.get(field(packet, "sourceKind"));
    if (
      source === undefined ||
      !same(object(packet.sourceRecordKey).source, {
        sourceId: source.sourceId,
        sourceManifestId: source.sourceManifestId,
        sourceReleaseId: source.sourceReleaseId,
      })
    )
      throw new Error(
        `Packet source is outside frozen scope: ${field(packet, "id")}`,
      );
    const item = queueByPacket.get(field(packet, "id"));
    if (
      item === undefined ||
      requiredKey(item) !== key ||
      item.sourceKind !== packet.sourceKind ||
      !same(item.reviewKinds, packet.queueMembership)
    )
      throw new Error(`Queue membership differs: ${field(packet, "id")}`);
    const expectedCounts = {
      identity: records(packet.identityCandidates).length,
      cultivation: records(packet.cultivationCandidates).length,
      taxonomy: records(packet.taxonomyOutcomes).length,
      localization: records(packet.localizationProposals).length,
      comparison: strings(packet.comparisonIds).length,
    };
    if (!same(item.candidateCounts, expectedCounts))
      throw new Error(`Queue candidate counts differ: ${field(item, "id")}`);
    const taxonomyOutcomes = [
      ...new Set(
        records(packet.taxonomyOutcomes).map((row) => field(row, "outcome")),
      ),
    ].sort();
    if (!same([...strings(item.taxonomyOutcomes)].sort(), taxonomyOutcomes))
      throw new Error(`Queue taxonomy outcomes differ: ${field(item, "id")}`);
    if (item.rightsStatus !== object(packet.rightsEvidence).commercialDecision)
      throw new Error(`Queue rights status differs: ${field(item, "id")}`);
    uniqueBy(records(packet.dependencies), (dependency) =>
      field(dependency, "role"),
    );
    for (const claim of [
      ...records(packet.identityCandidates),
      ...records(packet.cultivationCandidates),
    ]) {
      if (requiredKey(claim) !== key)
        throw new Error(
          `Candidate belongs to a different source record: ${field(claim, "id")}`,
        );
      const id = field(claim, "id");
      if (candidates.has(id)) throw new Error(`Duplicate candidate ${id}`);
      candidates.set(id, { claim, packet });
      assertSchemaForCandidate(
        api,
        field(packet, "sourceKind"),
        claim,
        records(packet.identityCandidates).includes(claim),
      );
    }
    for (const outcome of records(packet.taxonomyOutcomes)) {
      if (requiredKey(outcome) !== key)
        throw new Error(
          `WFO outcome belongs to another packet: ${field(outcome, "id")}`,
        );
      apiCheck(api, RUN_SCHEMA + "taxon-match-candidate", outcome);
    }
    for (const outcome of records(packet.localizationOutcomes))
      apiCheck(api, CURATION_SCHEMA + "taxref-wfo-link-outcome", outcome);
    for (const proposal of records(packet.localizationProposals))
      apiCheck(api, CURATION_SCHEMA + "taxref-localization-proposal", proposal);
    for (const proposal of records(packet.localizationProposals)) {
      const outcome = records(packet.localizationOutcomes).find(
        (row) => row.id === proposal.linkOutcomeId,
      );
      if (
        outcome === undefined ||
        outcome.outcome !== "linked" ||
        outcome.taxonId !== proposal.taxonId ||
        outcome.wfoCrosswalkId !== proposal.wfoCrosswalkId
      )
        throw new Error(
          `Localization proposal has no equivalent reviewed link: ${field(proposal, "id")}`,
        );
    }
    for (const id of strings(packet.comparisonIds))
      if (!comparisonById.has(id)) throw new Error(`Missing comparison ${id}`);
  }
  for (const item of queue)
    if (!packetById.has(field(item, "packetId")))
      throw new Error(`Missing packet ${field(item, "packetId")}`);
  for (const comparison of comparisons) {
    const owners = new Set<string>();
    for (const reference of records(comparison.candidates)) {
      const candidate = candidates.get(field(reference, "candidateId"));
      if (
        candidate === undefined ||
        !same(candidate.claim, reference.sourceClaim) ||
        requiredKey(object(reference.sourceClaimKey)) !==
          requiredKey(candidate.packet)
      )
        throw new Error(
          `Comparison candidate snapshot differs: ${field(comparison, "id")}`,
        );
      if (
        candidate.claim.sourceClaimKey !== undefined &&
        !same(candidate.claim.sourceClaimKey, reference.sourceClaimKey)
      )
        throw new Error(
          `Comparison semantic key differs: ${field(comparison, "id")}`,
        );
      owners.add(field(candidate.packet, "id"));
    }
    if (owners.size !== 2)
      throw new Error(
        `Comparison does not join two packets: ${field(comparison, "id")}`,
      );
    for (const packet of packets) {
      if (
        strings(packet.comparisonIds).includes(field(comparison, "id")) !==
        owners.has(field(packet, "id"))
      )
        throw new Error(
          `Comparison membership differs: ${field(comparison, "id")}`,
        );
    }
  }
  const expected: Record<string, number> = {
    "integrated-packets": packets.length,
    "integrated-queue-items": queue.length,
    "assertion-comparisons": comparisons.length,
    "grow-source-records": packets.filter(
      (packet) => packet.sourceKind === "grow",
    ).length,
    "cropgraph-selected-records": packets.filter(
      (packet) => packet.sourceKind === "cropgraph",
    ).length,
    "taxonomy-outcomes": packets.reduce(
      (count, packet) => count + records(packet.taxonomyOutcomes).length,
      0,
    ),
  };
  const visibleProposals = new Set(
    packets.flatMap((packet) =>
      records(packet.localizationProposals).map((proposal) =>
        field(proposal, "id"),
      ),
    ),
  ).size;
  const declaredProposals = counts.get("localization-proposals")?.count;
  if (
    typeof declaredProposals !== "number" ||
    declaredProposals < visibleProposals
  )
    throw new Error(
      "Localization proposal count is smaller than packet coverage",
    );
  for (const [role, count] of Object.entries(expected))
    if (counts.get(role)?.count !== count)
      throw new Error(`Frozen scope count differs: ${role}`);
}

function apiCheck(api: ValidationApi, schema: string, value: unknown): void {
  const result = api.validate(schema, value);
  if (!result.valid)
    throw new Error(`${schema}: ${JSON.stringify(result.errors)}`);
}

function assertSchemaForCandidate(
  api: ValidationApi,
  kind: string,
  claim: RecordValue,
  identity: boolean,
): void {
  // GROW's existing auxiliary candidates have no standalone schema.
  if (kind !== "grow")
    apiCheck(
      api,
      RUN_SCHEMA +
        (identity
          ? "cropgraph-identity-candidate"
          : "cropgraph-cultivation-candidate"),
      claim,
    );
}
