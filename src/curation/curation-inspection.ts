import { access } from "node:fs/promises";
import { join } from "node:path";
import {
  qualifiedSourceRecordKey,
  qualifiedSourceLocationKey,
  sourceRecordKey,
  type QualifiedSourceRecordKey,
} from "../domain/source-keys.js";
import { validate } from "../schema/validation-api.js";
import {
  field,
  object,
  records,
  same,
  strings,
  type RecordValue,
} from "./curation-artifacts.js";
import {
  currentRecords,
  curationPaths,
  validateCurationDataset,
  type CurationOptions,
  type CurationValidationResult,
  type ValidationDimension,
} from "./curation-validation.js";
import {
  readIntegratedReviewDraft,
  type IntegratedReviewDraft,
} from "./integrated-review-reader.js";
import type { ValidationDataset } from "./validation-dataset.js";

export interface EditorialGate {
  readonly status: ValidationDimension["status"];
  readonly available: boolean;
  readonly total: number | null;
  readonly accounted: number | null;
  readonly pending: number | null;
  readonly accepted: number;
  readonly rejected: number;
  readonly deferred: number;
}

export interface CurationStatusResult {
  readonly valid: boolean;
  readonly structural: ValidationDimension;
  readonly sourceAudit: ValidationDimension;
  readonly draftIntegrity: ValidationDimension;
  readonly draftManifestSha256?: string;
  readonly scopeCounts: readonly RecordValue[] | null;
  readonly editorial: Readonly<
    Record<
      "identity" | "subject" | "context" | "assertion" | "comparison",
      EditorialGate
    >
  >;
  readonly localization: {
    readonly available: boolean;
    readonly eligibleIdentities: number | null;
    readonly notYetEligibleRecords: number | null;
    readonly notReconciled: number | null;
    readonly outcomes: Readonly<Record<string, number>>;
    readonly proposalCount: number | null;
    readonly authoredFrenchNames: number;
  };
}

async function inspect(options: CurationOptions): Promise<{
  validation: CurationValidationResult;
  draft?: IntegratedReviewDraft;
  integrity: ValidationDimension;
}> {
  const validation = await validateCurationDataset(options);
  const paths = curationPaths(options);
  try {
    await access(join(paths.drafts, "draft-manifest.json"));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
    return {
      validation,
      integrity: { status: "planned", valid: null, issues: [] },
    };
  }
  try {
    const draft =
      validation.draft ??
      (await readIntegratedReviewDraft({
        directory: paths.drafts,
        validationApi: options.validationApi ?? { validate },
        ...(options.scopePath === undefined
          ? {}
          : { scopePath: options.scopePath }),
      }));
    return {
      validation,
      draft,
      integrity: { status: "validated", valid: true, issues: [] },
    };
  } catch (error) {
    return {
      validation,
      integrity: {
        status: "blocked",
        valid: false,
        issues: [
          {
            code: "DRAFT_INTEGRITY_FAILED",
            path: paths.drafts,
            message: error instanceof Error ? error.message : String(error),
          },
        ],
      },
    };
  }
}

export async function getCurationStatus(
  options: CurationOptions = {},
): Promise<CurationStatusResult> {
  const { validation, draft, integrity } = await inspect(options);
  const dataset = validation.loaded?.dataset;
  const valid = validation.valid && integrity.valid !== false;
  const usable = valid && draft !== undefined && dataset !== undefined;
  const editorial = {
    identity: unavailableGate(!valid),
    subject: unavailableGate(!valid),
    context: unavailableGate(!valid),
    assertion: unavailableGate(!valid),
    comparison: unavailableGate(!valid),
  };
  let localization: CurationStatusResult["localization"] = {
    available: false,
    eligibleIdentities: null,
    notYetEligibleRecords: null,
    notReconciled: null,
    outcomes: {},
    proposalCount: null,
    authoredFrenchNames:
      dataset?.localizedNames?.filter(
        (row) =>
          typeof row.languageTag === "string" &&
          /^fr(?:-|$)/.test(row.languageTag),
      ).length ?? 0,
  };
  if (usable) {
    const reviewed = reviewedPredicate(dataset);
    const names = currentRecords(dataset.sourceNameDecisions ?? []).filter(
      reviewed,
    );
    const subjects = currentRecords(
      dataset.sourceSubjectMappings ?? [],
      "supersedesMappingId",
    ).filter(reviewed);
    const assertionDecisions = currentRecords(
      dataset.sourceAssertionDecisions ?? [],
    ).filter(reviewed);
    const comparisonDecisions = currentRecords(
      dataset.assertionComparisonDecisions ?? [],
    ).filter(reviewed);
    const sourceKeys = new Set(
      draft.packets.map((packet) => sourceRecordKey(packet)!),
    );
    const candidateIds = new Set(
      draft.packets.flatMap((packet) =>
        records(packet.cultivationCandidates).map((candidate) =>
          field(candidate, "id"),
        ),
      ),
    );
    const comparisonIds = new Set(
      draft.comparisons.map((comparison) => field(comparison, "id")),
    );
    editorial.identity = gate(
      sourceKeys.size,
      names.filter(
        (row) =>
          sourceKeys.has(sourceRecordKey(row) ?? "") &&
          row.decision !== "unresolved",
      ),
    );
    editorial.subject = gate(
      sourceKeys.size,
      subjects.filter((row) => sourceKeys.has(sourceRecordKey(row) ?? "")),
    );
    editorial.assertion = gate(
      candidateIds.size,
      assertionDecisions.filter(
        (row) =>
          candidateIds.has(String(row.sourceCandidateId)) &&
          row.draftManifestSha256 === draft.manifestSha256,
      ),
    );
    editorial.comparison = gate(
      comparisonIds.size,
      comparisonDecisions.filter(
        (row) =>
          comparisonIds.has(String(row.comparisonId)) &&
          row.draftManifestSha256 === draft.manifestSha256,
      ),
    );
    const acceptedAssertions = assertionDecisions.filter(
      (row) =>
        row.decision === "accept" &&
        candidateIds.has(String(row.sourceCandidateId)) &&
        row.draftManifestSha256 === draft.manifestSha256,
    );
    editorial.context = gate(
      acceptedAssertions.length,
      acceptedAssertions.filter((row) =>
        dataset.contexts.some((context) => context.id === row.contextId),
      ),
    );
    const crosswalks = currentRecords(
      dataset.externalTaxonomyCrosswalks ?? [],
      "supersedesCrosswalkId",
    ).filter(reviewed);
    const crosswalkIds = new Set(
      names
        .filter((row) => sourceKeys.has(sourceRecordKey(row) ?? ""))
        .map((row) => String(row.externalTaxonomyCrosswalkId)),
    );
    const eligible = crosswalks.filter(
      (row) =>
        crosswalkIds.has(field(row, "id")) &&
        object(row.externalIdentifier).sourceId ===
          "source_world_flora_online_plant_list",
    );
    const eligibleIds = new Set(eligible.map((row) => field(row, "id")));
    const outcomes = new Map(
      draft.packets
        .flatMap((packet) => records(packet.localizationOutcomes))
        .filter((row) => eligibleIds.has(String(row.wfoCrosswalkId)))
        .map((row) => [field(row, "id"), row]),
    );
    const outcomeCounts: Record<string, number> = {
      linked: 0,
      ambiguous: 0,
      "not-found": 0,
      "concept-disagreement": 0,
    };
    for (const outcome of outcomes.values())
      outcomeCounts[field(outcome, "outcome")] =
        (outcomeCounts[field(outcome, "outcome")] ?? 0) + 1;
    const reconciled = new Set(
      [...outcomes.values()].map((row) => String(row.wfoCrosswalkId)),
    );
    const eligibleSourceKeys = new Set(
      names
        .filter((row) =>
          eligibleIds.has(String(row.externalTaxonomyCrosswalkId)),
        )
        .map((row) => sourceRecordKey(row)),
    );
    localization = {
      available: true,
      eligibleIdentities: eligible.length,
      notYetEligibleRecords: sourceKeys.size - eligibleSourceKeys.size,
      notReconciled: eligible.filter((row) => !reconciled.has(field(row, "id")))
        .length,
      outcomes: outcomeCounts,
      proposalCount: new Set(
        draft.packets.flatMap((packet) =>
          records(packet.localizationProposals).map((row) => field(row, "id")),
        ),
      ).size,
      authoredFrenchNames: localization.authoredFrenchNames,
    };
  }
  return {
    valid,
    structural: validation.structural,
    sourceAudit: validation.sourceAudit,
    draftIntegrity: integrity,
    ...(draft === undefined
      ? {}
      : { draftManifestSha256: draft.manifestSha256 }),
    scopeCounts: usable ? records(draft.scope.counts) : null,
    editorial,
    localization,
  };
}

export type CurationRecordSelector =
  | { readonly packetId: string }
  | { readonly sourceRecordKey: QualifiedSourceRecordKey }
  | {
      readonly recordId: string;
      readonly sourceId?: string;
      readonly sourceManifestId?: string;
      readonly sourceReleaseId?: string;
    };

export async function showCurationRecord(
  selector: CurationRecordSelector,
  options: CurationOptions = {},
) {
  const { validation, draft, integrity } = await inspect(options);
  if (draft === undefined || validation.loaded === undefined)
    throw new Error(
      `Review material is unavailable: ${integrity.issues.map((issue) => issue.message).join("; ")}`,
    );
  const matches = draft.packets.filter((packet) => {
    if ("packetId" in selector) return packet.id === selector.packetId;
    if ("sourceRecordKey" in selector)
      return same(packet.sourceRecordKey, selector.sourceRecordKey);
    const key = qualifiedSourceRecordKey(packet)!;
    return (
      key.recordId === selector.recordId &&
      (selector.sourceId === undefined ||
        selector.sourceId === key.source.sourceId) &&
      (selector.sourceManifestId === undefined ||
        selector.sourceManifestId === key.source.sourceManifestId) &&
      (selector.sourceReleaseId === undefined ||
        selector.sourceReleaseId === key.source.sourceReleaseId)
    );
  });
  if (matches.length !== 1)
    throw new Error(
      matches.length === 0
        ? "Source record was not found in the explicit review scope"
        : "Source record selector is ambiguous; supply its qualified source key or packet ID",
    );
  const packet = matches[0]!;
  const dataset = validation.loaded.dataset;
  const key = sourceRecordKey(packet);
  const candidateIds = new Set(
    records(packet.cultivationCandidates).map((row) => field(row, "id")),
  );
  const locationIds = new Set(
    records(packet.cultivationCandidates).flatMap((row) => {
      const direct = qualifiedSourceLocationKey(row);
      if (direct !== undefined) return [direct.locationId];
      if (
        row.applicability === undefined ||
        object(row.applicability).geography === undefined
      )
        return [];
      const geography = object(object(row.applicability).geography);
      return typeof geography.sheetCode === "string"
        ? [geography.sheetCode]
        : [];
    }),
  );
  const decisions = {
    name: (dataset.sourceNameDecisions ?? []).filter(
      (row) => sourceRecordKey(row) === key,
    ),
    subject: (dataset.sourceSubjectMappings ?? []).filter(
      (row) => sourceRecordKey(row) === key,
    ),
    assertion: (dataset.sourceAssertionDecisions ?? []).filter((row) =>
      candidateIds.has(String(row.sourceCandidateId)),
    ),
    comparison: (dataset.assertionComparisonDecisions ?? []).filter((row) =>
      strings(packet.comparisonIds).includes(String(row.comparisonId)),
    ),
    geography: (dataset.sourceGeographyDecisions ?? []).filter((row) => {
      const location = qualifiedSourceLocationKey(row);
      return (
        location !== undefined &&
        locationIds.has(location.locationId) &&
        same(location.source, qualifiedSourceRecordKey(packet)!.source)
      );
    }),
  };
  const assertionIds = new Set(
    decisions.assertion.map((row) => String(row.assertionId)),
  );
  const assertions = dataset.assertions.filter((row) =>
    assertionIds.has(field(row, "id")),
  );
  const crosswalkIds = new Set(
    [...decisions.name, ...decisions.subject].map((row) =>
      String(row.externalTaxonomyCrosswalkId),
    ),
  );
  const crosswalks = (dataset.externalTaxonomyCrosswalks ?? []).filter((row) =>
    crosswalkIds.has(field(row, "id")),
  );
  const taxonIds = new Set(crosswalks.map((row) => String(row.taxonId)));
  const subjects = decisions.subject.flatMap((row) =>
    row.subject === undefined ? [] : [object(row.subject)],
  );
  const contextIds = new Set(
    decisions.assertion.map((row) => String(row.contextId)),
  );
  const evidenceIds = new Set(
    assertions.flatMap((row) => strings(row.evidenceReferenceIds)),
  );
  const relatedIds = new Set([
    field(packet, "id"),
    key!,
    ...records(packet.cultivationCandidates).map((row) => field(row, "id")),
    ...strings(packet.comparisonIds),
    ...Object.values(decisions)
      .flat()
      .map((row) => field(row, "id")),
  ]);
  const issues = (dataset.curationIssues ?? []).filter((row) =>
    strings(row.affectedRecordIds).some((id) => relatedIds.has(id)),
  );
  const authored = {
    crosswalks,
    taxa: dataset.taxa.filter((row) => taxonIds.has(field(row, "id"))),
    taxonomicNames: (dataset.taxonomicNames ?? []).filter((row) =>
      taxonIds.has(String(row.taxonId)),
    ),
    subjects: subjects.flatMap((subject) =>
      (subject.type === "plant-concept"
        ? dataset.plantConcepts
        : subject.type === "cultivar-group"
          ? (dataset.cultivarGroups ?? [])
          : dataset.cultivars
      ).filter((row) => row.id === subject.id),
    ),
    localizedNames: (dataset.localizedNames ?? []).filter((row) => {
      const subject = object(row.subject);
      return (
        (subject.type === "taxon" && taxonIds.has(String(subject.id))) ||
        subjects.some((target) => same(target, subject))
      );
    }),
    contexts: dataset.contexts.filter((row) =>
      contextIds.has(field(row, "id")),
    ),
    assertions,
    evidence: dataset.evidence.filter((row) =>
      evidenceIds.has(field(row, "id")),
    ),
    curationIssues: issues,
  };
  for (const row of Object.values(authored).flat()) {
    if (row.evidenceReferenceIds !== undefined)
      for (const id of strings(row.evidenceReferenceIds)) evidenceIds.add(id);
  }
  authored.evidence = dataset.evidence.filter((row) =>
    evidenceIds.has(field(row, "id")),
  );
  const geographyIds = new Set([
    ...decisions.geography.flatMap((row) =>
      typeof row.geographicContextId === "string"
        ? [row.geographicContextId]
        : [],
    ),
    ...authored.contexts.flatMap((row) => {
      const scope = object(row.geographicScope);
      return scope.type === "specified"
        ? strings(scope.geographicContextIds)
        : [];
    }),
  ]);
  const reviewIds = new Set(
    [
      ...Object.values(decisions).flat(),
      ...Object.values(authored).flat(),
    ].flatMap((row) =>
      typeof row.reviewId === "string" ? [row.reviewId] : [],
    ),
  );
  for (const evidence of authored.evidence)
    reviewIds.add(field(object(evidence.rights), "reviewId"));
  return {
    valid: validation.valid && integrity.valid === true,
    structural: validation.structural,
    sourceAudit: validation.sourceAudit,
    draftIntegrity: integrity,
    draftManifestSha256: draft.manifestSha256,
    packet,
    comparisons: draft.comparisons.filter((row) =>
      strings(packet.comparisonIds).includes(field(row, "id")),
    ),
    decisions,
    authored: {
      ...authored,
      geographicContexts: (dataset.geographicContexts ?? []).filter((row) =>
        geographyIds.has(field(row, "id")),
      ),
      reviews: dataset.reviews.filter((row) => reviewIds.has(field(row, "id"))),
    },
  };
}

function reviewedPredicate(
  dataset: ValidationDataset,
): (row: RecordValue) => boolean {
  const accepted = new Set(
    dataset.reviews
      .filter((row) => row.status === "accepted" && row.purpose === "content")
      .map((row) => field(row, "id")),
  );
  return (row) => accepted.has(String(row.reviewId));
}

function unavailableGate(blocked: boolean): EditorialGate {
  return {
    status: blocked ? "blocked" : "in progress",
    available: false,
    total: null,
    accounted: null,
    pending: null,
    accepted: 0,
    rejected: 0,
    deferred: 0,
  };
}

function gate(total: number, decisions: readonly RecordValue[]): EditorialGate {
  const rejected = decisions.filter((row) => row.decision === "reject").length;
  const deferred = decisions.filter((row) => row.decision === "defer").length;
  return {
    status: decisions.length === total ? "validated" : "in progress",
    available: true,
    total,
    accounted: decisions.length,
    pending: total - decisions.length,
    accepted: decisions.length - rejected - deferred,
    rejected,
    deferred,
  };
}
