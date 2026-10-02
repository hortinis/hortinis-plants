import {
  qualifiedSourceRecordKey,
  sourceRecordKey,
  sourceLocationKey,
} from "../domain/source-keys.js";
import {
  collectionSchemaIds,
  roleToDatasetField,
} from "./grow-wfo-validation.js";
import {
  field,
  object,
  records,
  same,
  strings,
  type RecordValue,
} from "./curation-artifacts.js";
import type { IntegratedReviewDraft } from "./integrated-review-reader.js";
import type { ValidationDataset } from "./validation-dataset.js";

export const operationCollections: Readonly<Record<string, readonly string[]>> =
  {
    identity: [
      "taxa",
      "taxonomic-names",
      "external-taxonomy-crosswalks",
      "source-name-decisions",
    ],
    subject: [
      "plant-concepts",
      "cultivar-groups",
      "cultivars",
      "source-subject-mappings",
    ],
    localization: ["localized-names"],
    context: [
      "geographic-contexts",
      "cultivation-contexts",
      "source-geography-decisions",
    ],
    assertion: ["assertions", "source-assertion-decisions"],
    comparison: ["assertion-comparison-decisions"],
    issue: ["curation-issues"],
  };

export function packetForDecision(
  decision: RecordValue,
  draft: IntegratedReviewDraft,
): RecordValue {
  const source = object(decision.source);
  const packet = draft.packets.find((row) => row.id === source.packetId);
  if (
    packet === undefined ||
    !same(packet.sourceRecordKey, source.sourceRecordKey) ||
    packet.contentSha256 !== source.packetSha256
  )
    throw new Error(
      "Decision packet, source key or content pin differs from frozen draft",
    );
  const queue = draft.queue.find((row) => row.packetId === packet.id);
  if (queue === undefined || !same(packet.queueMembership, queue.reviewKinds))
    throw new Error("Decision packet has no frozen queue membership");
  return packet;
}

export function packetDecisionEvidence(
  source: RecordValue,
  kind: string,
  packet: RecordValue,
  draft: IntegratedReviewDraft,
): RecordValue {
  return {
    sourceRecordSnapshot: packet.sourceRecord,
    dependencies: packet.dependencies,
    rightsEvidence: packet.rightsEvidence,
    candidateSnapshots:
      kind === "localization"
        ? records(packet.localizationProposals).filter((row) =>
            strings(source.candidateIds ?? []).includes(field(row, "id")),
          )
        : [
            ...records(packet.identityCandidates),
            ...records(packet.taxonomyOutcomes),
            ...records(packet.cultivationCandidates),
          ].filter((row) =>
            source.candidateIds === undefined
              ? ["identity", "subject", "issue"].includes(kind)
              : strings(source.candidateIds).includes(field(row, "id")),
          ),
    comparisonSnapshots: draft.comparisons.filter((row) =>
      strings(source.comparisonIds ?? []).includes(field(row, "id")),
    ),
  };
}

export function auditPacketDecision(
  decision: RecordValue,
  dataset: ValidationDataset,
  draft: IntegratedReviewDraft,
): void {
  const packet = packetForDecision(decision, draft);
  if (decision.draftManifestSha256 !== draft.manifestSha256)
    throw new Error("Packet decision has a stale draft fingerprint");
  const source = object(decision.source);
  const kind = field(decision, "kind");
  for (const [key, value] of Object.entries(
    packetDecisionEvidence(source, kind, packet, draft),
  ))
    if (!same(decision[key], value))
      throw new Error(`Packet decision evidence differs: ${key}`);
  const candidateIds = strings(source.candidateIds ?? []);
  const comparisonIds = strings(source.comparisonIds ?? []);
  const available =
    kind === "localization"
      ? records(packet.localizationProposals)
      : ["identity", "subject"].includes(kind)
        ? [
            ...records(packet.identityCandidates),
            ...records(packet.taxonomyOutcomes),
          ]
        : records(packet.cultivationCandidates);
  for (const id of candidateIds)
    if (!available.some((row) => row.id === id))
      throw new Error(`Decision candidate is outside packet: ${id}`);
  for (const id of comparisonIds)
    if (!strings(packet.comparisonIds).includes(id))
      throw new Error(`Decision comparison is outside packet: ${id}`);
  if (
    ["assertion", "localization", "context"].includes(kind) &&
    candidateIds.length === 0
  )
    throw new Error(`${kind} requires explicit candidate or proposal IDs`);
  if (kind === "comparison" && comparisonIds.length === 0)
    throw new Error("Comparison requires explicit comparison IDs");
  if (kind !== "comparison" && comparisonIds.length > 0)
    throw new Error("Only comparison operations may select comparisons");
  const entries = records(decision.records);
  const authored = entries.map((row) => ({
    collection: field(row, "collection"),
    value: object(row.value),
  }));
  for (const { collection, value } of authored) {
    if (
      ![
        ...(operationCollections[kind] ?? []),
        "evidence-references",
        "reviews",
      ].includes(collection)
    )
      throw new Error(`${kind} cannot author ${collection}`);
    const key = sourceRecordKey(value);
    if (
      key !== undefined &&
      collection !== "evidence-references" &&
      key !== sourceRecordKey(packet)
    )
      throw new Error("Authored record belongs to another qualified source");
    if (
      typeof value.reviewId === "string" &&
      collection !== "evidence-references" &&
      value.reviewId !== decision.reviewId
    )
      throw new Error("Authored record uses a different content review");
    if (
      collection === "source-assertion-decisions" &&
      (!candidateIds.includes(String(value.sourceCandidateId)) ||
        value.draftManifestSha256 !== draft.manifestSha256 ||
        value.decision !== decision.disposition)
    )
      throw new Error(
        "Assertion disposition does not match selected candidate or review disposition",
      );
    if (
      collection === "assertion-comparison-decisions" &&
      (!comparisonIds.includes(String(value.comparisonId)) ||
        value.draftManifestSha256 !== draft.manifestSha256 ||
        (decision.disposition === "defer"
          ? value.decision !== "defer"
          : decision.disposition !== "accept" ||
            !["prefer-assertion", "retain-both"].includes(
              String(value.decision),
            )))
    )
      throw new Error(
        "Comparison disposition does not match selected comparison",
      );
    if (
      collection === "source-name-decisions" &&
      (decision.disposition === "reject"
        ? value.decision !== "reject"
        : decision.disposition === "defer"
          ? value.decision !== "unresolved"
          : ![
              "accept-candidate",
              "manual-match",
              "documented-correction",
              "not-taxonomic",
            ].includes(String(value.decision)))
    )
      throw new Error(
        "Identity disposition disagrees with source name decision",
      );
    if (
      collection === "source-subject-mappings" &&
      (decision.disposition === "accept"
        ? value.decision !== "map"
        : value.decision !== decision.disposition)
    )
      throw new Error("Subject disposition disagrees with source mapping");
    if (collection === "source-geography-decisions") {
      const locations = candidateIds
        .flatMap((id) => available.filter((row) => row.id === id))
        .map((row) => {
          const geography = object(object(row.applicability).geography);
          return sourceLocationKey({
            source: qualifiedSourceRecordKey(packet)?.source,
            sourceLocation: { sheetCode: geography.sheetCode },
          });
        });
      const matched = available
        .filter((row) => candidateIds.includes(field(row, "id")))
        .find((row) => {
          const geography = object(object(row.applicability).geography);
          return geography.sheetCode === object(value.sourceLocation).sheetCode;
        });
      if (matched === undefined)
        throw new Error("Geography has no selected source location");
      const original = object(object(matched.applicability).geography);
      const authoredLocation = object(value.sourceLocation);
      const expectedLocator =
        original.locator ??
        (typeof matched.sourceLocator === "string"
          ? matched.sourceLocator.split("!").slice(0, 2).join("!")
          : undefined);
      if (
        authoredLocation.country !== original.country ||
        authoredLocation.name !== original.name ||
        authoredLocation.locator !== expectedLocator
      )
        throw new Error(
          "Geography decision must retain frozen country, name and locator",
        );
      if (
        !locations.includes(sourceLocationKey(value)) ||
        sourceLocationKey(value) === undefined
      )
        throw new Error(
          "Geography decision is outside selected candidate locations",
        );
      if (
        decision.disposition === "accept"
          ? value.decision !== "map"
          : value.decision !== decision.disposition
      )
        throw new Error("Geography disposition disagrees with mapping");
    }
  }
  const primary = operationCollections[kind] ?? [];
  if (
    decision.disposition !== "accept" &&
    authored.some(
      (row) =>
        primary.includes(row.collection) &&
        !row.collection.endsWith("decisions") &&
        row.collection !== "source-subject-mappings" &&
        row.collection !== "curation-issues",
    )
  )
    throw new Error(
      "Rejected or deferred operation cannot author accepted facts",
    );
  if (kind === "assertion" && decision.disposition === "accept") {
    for (const id of candidateIds) {
      const candidate = available.find((row) => row.id === id)!;
      const value = object(candidate.value ?? candidate.normalizedValue ?? {});
      if (value.sourceAction === "plant_now")
        throw new Error(
          "Dynamic plant_now candidate must remain rejected or deferred",
        );
      const individual = authored.find(
        (row) =>
          row.collection === "source-assertion-decisions" &&
          row.value.sourceCandidateId === id,
      )?.value;
      const assertion = dataset.assertions.find(
        (row) => row.id === individual?.assertionId,
      );
      if (
        assertion !== undefined &&
        !dataset.evidence.some(
          (row) =>
            strings(assertion.evidenceReferenceIds).includes(
              field(row, "id"),
            ) &&
            sourceRecordKey(row) === sourceRecordKey(candidate) &&
            same(
              object(row.normalization ?? {}).originalValue,
              candidate.rawValue,
            ),
        )
      )
        throw new Error(
          "Accepted assertion must retain candidate raw value in evidence normalization",
        );
    }
  }
  if (kind === "assertion")
    for (const id of candidateIds) {
      if (
        !authored.some(
          (row) =>
            row.collection === "source-assertion-decisions" &&
            row.value.sourceCandidateId === id,
        )
      )
        throw new Error(`Missing individual assertion disposition: ${id}`);
    }
  if (kind === "comparison")
    for (const id of comparisonIds) {
      if (
        !authored.some(
          (row) =>
            row.collection === "assertion-comparison-decisions" &&
            row.value.comparisonId === id,
        )
      )
        throw new Error(`Missing individual comparison disposition: ${id}`);
    }
  if (
    kind === "context" &&
    decision.disposition === "accept" &&
    !authored.some((row) =>
      ["cultivation-contexts", "source-geography-decisions"].includes(
        row.collection,
      ),
    )
  )
    throw new Error(
      "Accepted context requires an explicit context or geography mapping record",
    );
  if (
    kind === "identity" &&
    !authored.some((row) => row.collection === "source-name-decisions")
  )
    throw new Error("Identity operation requires a source name decision");
  if (
    kind === "subject" &&
    !authored.some((row) => row.collection === "source-subject-mappings")
  )
    throw new Error("Subject operation requires a source subject mapping");
  if (kind === "issue") {
    const related = new Set([
      field(packet, "id"),
      ...records(packet.cultivationCandidates).map((row) => field(row, "id")),
      ...strings(packet.comparisonIds),
      ...Object.values(object(packet.authoredDecisions))
        .flatMap(records)
        .map((row) => field(row, "id")),
    ]);
    if (!authored.some((row) => row.collection === "curation-issues"))
      throw new Error("Issue operation requires an issue record");
    for (const row of authored.filter(
      (row) => row.collection === "curation-issues",
    ))
      if (!strings(row.value.affectedRecordIds).some((id) => related.has(id)))
        throw new Error("Issue has no affected record in selected packet");
  }
  if (kind === "localization" && decision.disposition === "accept") {
    for (const id of candidateIds) {
      const proposal = available.find((row) => row.id === id)!;
      const candidate = object(proposal.candidate);
      const value = object(candidate.value);
      const matches = authored.filter(
        (row) =>
          row.collection === "localized-names" &&
          same(row.value.subject, { type: "taxon", id: proposal.taxonId }) &&
          row.value.value === value.text &&
          row.value.languageTag === value.languageTag,
      );
      if (matches.length === 0)
        throw new Error("Localized name differs from frozen TAXREF proposal");
      const crosswalk = dataset.externalTaxonomyCrosswalks?.find(
        (row) => row.id === proposal.wfoCrosswalkId,
      );
      const review = dataset.reviews.find(
        (row) => row.id === crosswalk?.reviewId,
      );
      if (
        crosswalk?.taxonId !== proposal.taxonId ||
        review?.status !== "accepted"
      )
        throw new Error(
          "Localization requires the reviewed WFO proposal target",
        );
      for (const match of matches)
        if (
          !dataset.evidence.some(
            (row) =>
              strings(match.value.evidenceReferenceIds).includes(
                field(row, "id"),
              ) &&
              sourceRecordKey(row) === sourceRecordKey(candidate) &&
              strings(candidate.sourceLocators).includes(String(row.locator)) &&
              object(row.rights).licenceId === candidate.licenceId,
          )
        )
          throw new Error(
            "Localized name lacks TAXREF candidate provenance and rights",
          );
    }
    if (
      authored
        .filter((row) => row.collection === "localized-names")
        .some(
          (row) =>
            !candidateIds.some((id) => {
              const proposal = available.find((item) => item.id === id)!;
              const candidate = object(proposal.candidate);
              const value = object(candidate.value);
              return (
                same(row.value.subject, {
                  type: "taxon",
                  id: proposal.taxonId,
                }) &&
                row.value.value === value.text &&
                row.value.languageTag === value.languageTag
              );
            }),
        )
    )
      throw new Error("Localized name is outside selected proposals");
  }
}

/** Historical approvals are carried as immutable snapshots, never repinned to new candidates. */
export function auditPacketDecisions(
  dataset: ValidationDataset,
  draft: IntegratedReviewDraft,
): void {
  const snapshots = draft.packets.flatMap((packet) =>
    records(object(packet.authoredDecisions).packetDecisions ?? []),
  );
  const superseded = new Set(
    (dataset.packetDecisions ?? []).map((row) => row.supersedesDecisionId),
  );
  for (const decision of dataset.packetDecisions ?? []) {
    if (superseded.has(decision.id)) continue;
    if (snapshots.some((row) => same(row, decision))) continue;
    auditPacketDecision(decision, dataset, draft);
  }
}

export function authoredRecords(
  dataset: ValidationDataset,
  collection: string,
): readonly RecordValue[] {
  const key = roleToDatasetField[collection];
  if (key === undefined || collectionSchemaIds[collection] === undefined)
    throw new Error(`Unsupported authoring collection ${collection}`);
  return (dataset[key] as readonly RecordValue[]) ?? [];
}
