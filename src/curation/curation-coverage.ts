import { join, resolve } from "node:path";
import { validate } from "../schema/validation-api.js";
import { sourceRecordKey } from "../domain/source-keys.js";
import {
  currentRecords,
  curationPaths,
  type CurationOptions,
  type ValidationDimension,
} from "./curation-validation.js";
import {
  contentDigest,
  field,
  object,
  readObject,
  records,
  same,
  strings,
  uniqueBy,
  type RecordValue,
} from "./curation-artifacts.js";
import type { IntegratedReviewDraft } from "./integrated-review-reader.js";
import type { ValidationDataset } from "./validation-dataset.js";

export interface CoverageCount {
  readonly total: number | null;
  readonly accepted: number;
  readonly rejected: number;
  readonly deferred: number;
  readonly pending: number | null;
}

export interface CoverageOptions extends CurationOptions {
  readonly targetsPath?: string;
}

/** All counts use unique qualified records or opaque candidate IDs, never array positions. */
export async function buildCurationCoverage(
  options: CoverageOptions,
  dataset: ValidationDataset | undefined,
  draft: IntegratedReviewDraft | undefined,
  dimensions: {
    structural: ValidationDimension;
    sourceAudit: ValidationDimension;
    draftIntegrity: ValidationDimension;
  },
) {
  const targetPath = resolve(
    options.targetsPath ??
      join(curationPaths(options).root, "data/curation/delivery-targets.json"),
  );
  const targetFile = await readObject(
    targetPath,
    options.validationApi ?? { validate },
    "urn:hortinis:plants:schema:curation:v1:delivery-targets",
  );
  const targets = records(targetFile.targets);
  uniqueBy(targets, (row) => field(row, "id"));
  uniqueBy(
    targets.filter((row) => row.subjectId !== undefined),
    (row) => `${field(row, "kind")}:${field(row, "subjectId")}`,
  );
  const available =
    dataset !== undefined &&
    draft !== undefined &&
    dimensions.structural.valid === true &&
    dimensions.draftIntegrity.valid === true &&
    dimensions.sourceAudit.valid !== false;
  const acceptedReviews = new Set(
    (dataset?.reviews ?? [])
      .filter((row) => row.status === "accepted")
      .map((row) => `${field(row, "purpose")}:${field(row, "id")}`),
  );
  const reviewed = (row: RecordValue, purpose = "content") =>
    typeof row.reviewId === "string" &&
    acceptedReviews.has(`${purpose}:${row.reviewId}`);
  // History is reusable for accounting only after a deep audit and exact evidence checks.
  // The original approval hash is never changed and changed inputs still require new review.
  const evidenceCurrent = (row: RecordValue) => {
    if (draft === undefined) return false;
    if (row.draftManifestSha256 === draft.manifestSha256) return true;
    if (dimensions.sourceAudit.valid !== true) return false;
    const packet = draft.packets.find((item) =>
      same(item.sourceRecordKey, object(row.source).sourceRecordKey),
    );
    if (
      packet === undefined ||
      !same(packet.sourceRecord, row.sourceRecordSnapshot) ||
      !same(packet.rightsEvidence, row.rightsEvidence)
    )
      return false;
    const inputs = (rows: readonly RecordValue[]) =>
      rows.filter((item) => item.role !== "authoring-dataset-manifest");
    if (
      !same(
        inputs(records(packet.dependencies)),
        inputs(records(row.dependencies)),
      )
    )
      return false;
    const candidates = [
      ...records(packet.identityCandidates),
      ...records(packet.taxonomyOutcomes),
      ...records(packet.cultivationCandidates),
      ...records(packet.localizationProposals),
    ];
    return (
      records(row.candidateSnapshots).every((snapshot) =>
        candidates.some((candidate) => same(candidate, snapshot)),
      ) &&
      records(row.comparisonSnapshots).every((snapshot) =>
        draft.comparisons.some((comparison) => same(comparison, snapshot)),
      ) &&
      records(object(packet.authoredDecisions).packetDecisions ?? []).some(
        (snapshot) => same(snapshot, row),
      )
    );
  };
  const decisions = currentRecords(dataset?.packetDecisions ?? []).filter(
    (row) => reviewed(row) && evidenceCurrent(row),
  );
  const names = currentRecords(dataset?.sourceNameDecisions ?? []).filter(
    reviewedContent,
  );
  const mappings = currentRecords(
    dataset?.sourceSubjectMappings ?? [],
    "supersedesMappingId",
  ).filter(reviewedContent);
  const namesByKey = new Map(names.map((row) => [sourceRecordKey(row), row]));
  const mappingsByKey = new Map(
    mappings.map((row) => [sourceRecordKey(row), row]),
  );
  const domainCurrent = (row: RecordValue, kind: string) =>
    row.draftManifestSha256 === draft?.manifestSha256 ||
    decisions.some(
      (decision) =>
        decision.kind === kind &&
        records(decision.records).some(
          (item) => item.id === row.id && same(item.value, row),
        ),
    );
  const assertions = currentRecords(
    dataset?.sourceAssertionDecisions ?? [],
  ).filter((row) => reviewed(row) && domainCurrent(row, "assertion"));
  const comparisons = currentRecords(
    dataset?.assertionComparisonDecisions ?? [],
  ).filter((row) => reviewed(row) && domainCurrent(row, "comparison"));
  const assertionsByCandidate = new Map(
    assertions.map((row) => [row.sourceCandidateId, row]),
  );
  const comparisonsById = new Map(
    comparisons.map((row) => [row.comparisonId, row]),
  );
  function reviewedContent(row: RecordValue) {
    return reviewed(row);
  }
  const authoredAssertions = (dataset?.assertions ?? []).filter(
    reviewedContent,
  );
  const scopedCandidateIds = new Set(
    draft?.packets.flatMap((packet) =>
      records(packet.cultivationCandidates).map((candidate) =>
        field(candidate, "id"),
      ),
    ) ?? [],
  );
  const liveAssertionIds = new Set(
    assertions
      .filter(
        (row) =>
          row.decision === "accept" &&
          scopedCandidateIds.has(field(row, "sourceCandidateId")),
      )
      .map((row) => field(row, "assertionId")),
  );
  const liveAssertions = authoredAssertions.filter((row) =>
    liveAssertionIds.has(field(row, "id")),
  );
  const rightsEligible = (row: RecordValue) => {
    const ids = strings(row.evidenceReferenceIds);
    return (
      ids.length > 0 &&
      ids.every((id) => {
        const evidence = dataset?.evidence.find((item) => item.id === id);
        if (evidence === undefined) return false;
        const rights = object(evidence.rights);
        return (
          rights.decision === "eligible" &&
          reviewed(rights, "rights") &&
          dataset?.licences?.some(
            (licence) =>
              licence.id === rights.licenceId &&
              licence.commercialUse === "allowed",
          )
        );
      })
    );
  };
  const issues = dataset?.curationIssues ?? [];
  const limitations = issues.filter(
    (row) =>
      row.status === "accepted-limitation" &&
      typeof row.resolution === "string" &&
      decisions.some(
        (decision) =>
          decision.kind === "issue" &&
          decision.disposition === "accept" &&
          records(decision.records).some(
            (item) => item.id === row.id && same(item.value, row),
          ),
      ),
  );
  const limited = (id: string) =>
    limitations.some((issue) => strings(issue.affectedRecordIds).includes(id));
  const deferrals = [
    ...decisions.filter((row) => row.disposition === "defer"),
    ...assertions.filter((row) => row.decision === "defer"),
    ...comparisons.filter((row) => row.decision === "defer"),
    ...mappings.filter((row) => row.decision === "defer"),
  ];
  const uncoveredDeferrals = deferrals.filter(
    (row) =>
      !limited(field(row, "id")) &&
      !decisions.some(
        (decision) =>
          limited(field(decision, "id")) &&
          records(decision.records).some(
            (item) => item.id === row.id && same(item.value, row),
          ),
      ),
  );
  const disposition = (
    rows: readonly RecordValue[],
    id: string,
    selection: string,
    snapshot: RecordValue,
  ) => {
    const matches = rows.filter(
      (row) =>
        (object(row.source)[selection] === undefined
          ? row.kind === "identity"
          : strings(object(row.source)[selection]).includes(id)) &&
        records(row.candidateSnapshots).some((item) => same(item, snapshot)) &&
        sourceRecordKey(object(row.source)) ===
          (sourceRecordKey(snapshot) ?? sourceRecordKey(snapshot.source ?? {})),
    );
    return matches.length === 1 ? field(matches[0]!, "disposition") : "pending";
  };
  const cohort = (kind: string) => {
    const packets = available
      ? draft.packets.filter((packet) => packet.sourceKind === kind)
      : [];
    const keys = new Set(packets.map((packet) => sourceRecordKey(packet)));
    const identity = count(
      available
        ? [...keys].map((key) => {
            const row = namesByKey.get(key);
            return row === undefined
              ? "pending"
              : row.decision === "unresolved"
                ? limited(field(row, "id"))
                  ? "defer"
                  : "pending"
                : ["reject", "not-taxonomic"].includes(String(row.decision))
                  ? "reject"
                  : "accept";
          })
        : undefined,
    );
    const subject = count(
      available
        ? [...keys].map((key) => {
            const row = mappingsByKey.get(key);
            return row === undefined
              ? "pending"
              : row.decision === "map"
                ? "accept"
                : field(row, "decision");
          })
        : undefined,
    );
    const families: Record<string, CoverageCount> = {};
    for (const family of [
      "identityCandidates",
      "taxonomyOutcomes",
      "cultivationCandidates",
      "localizationProposals",
    ]) {
      const candidates = [
        ...new Map(
          packets
            .flatMap((packet) => records(packet[family]))
            .map((row) => [field(row, "id"), row]),
        ).values(),
      ];
      families[family] = count(
        available
          ? candidates.map((candidate) => {
              if (family === "cultivationCandidates")
                return text(
                  assertionsByCandidate.get(candidate.id)?.decision ??
                    "pending",
                );
              return disposition(
                decisions.filter(
                  (row) =>
                    row.kind ===
                    (family === "localizationProposals"
                      ? "localization"
                      : "identity"),
                ),
                field(candidate, "id"),
                "candidateIds",
                candidate,
              );
            })
          : undefined,
      );
    }
    const actions: Record<string, CoverageCount> = {};
    const candidates = packets.flatMap((packet) =>
      records(packet.cultivationCandidates),
    );
    const actionOf = (row: RecordValue) => {
      const value = optionalObject(row.normalizedValue);
      const raw = optionalObject(row.value);
      return text(
        row.action ??
          value.action ??
          raw.action ??
          raw.sourceAction ??
          "unspecified",
      );
    };
    for (const action of [...new Set(candidates.map(actionOf))].sort())
      actions[action] = count(
        candidates
          .filter((row) => actionOf(row) === action)
          .map((candidate) =>
            text(
              assertionsByCandidate.get(candidate.id)?.decision ?? "pending",
            ),
          ),
      );
    const accepted = assertions.filter(
      (row) =>
        row.decision === "accept" &&
        candidates.some((candidate) => candidate.id === row.sourceCandidateId),
    );
    const facts = accepted
      .map((row) =>
        authoredAssertions.find((item) => item.id === row.assertionId),
      )
      .filter((row): row is RecordValue => row !== undefined);
    return {
      records: available ? keys.size : null,
      identity,
      subject,
      candidates: families,
      actions,
      acceptedAssertions: facts.length,
      commercialRights: count(
        available
          ? facts.map((row) => (rightsEligible(row) ? "accept" : "pending"))
          : undefined,
      ),
      contexts: count(
        available
          ? facts.map((row) => {
              const context = dataset?.contexts.find(
                (item) => item.id === row.contextId,
              );
              return context !== undefined &&
                object(context.geographicScope).type === "specified" &&
                context.growingSystem !== "unknown"
                ? "accept"
                : limited(field(row, "id"))
                  ? "defer"
                  : "pending";
            })
          : undefined,
      ),
    };
  };
  const delivery = targets.map((target) => {
    const subject = (
      target.kind === "plant-concept"
        ? dataset?.plantConcepts
        : dataset?.cultivars
    )?.find((row) => row.id === target.subjectId && row.status === "active");
    const bound = subject !== undefined && reviewed(target);
    const taxonId =
      subject === undefined
        ? undefined
        : target.kind === "plant-concept"
          ? subject.taxonId
          : dataset?.plantConcepts.find(
              (row) => row.id === subject.plantConceptId,
            )?.taxonId;
    const facts = bound
      ? liveAssertions.filter((row) =>
          same(row.subject, { type: target.kind, id: subject.id }),
        )
      : [];
    const linked =
      bound &&
      mappings.some(
        (row) =>
          row.decision === "map" &&
          same(row.subject, { type: target.kind, id: subject.id }) &&
          names.some(
            (name) =>
              sourceRecordKey(name) === sourceRecordKey(row) &&
              [
                "accept-candidate",
                "manual-match",
                "documented-correction",
              ].includes(String(name.decision)) &&
              (dataset?.externalTaxonomyCrosswalks ?? []).some(
                (crosswalk) =>
                  crosswalk.id === name.externalTaxonomyCrosswalkId &&
                  reviewed(crosswalk) &&
                  typeof taxonId === "string" &&
                  crosswalk.taxonId === taxonId &&
                  object(crosswalk.externalIdentifier).sourceId ===
                    "source_world_flora_online_plant_list",
              ),
          ),
      );
    const localized = (language: string, taxon = false) =>
      bound &&
      (dataset?.localizedNames ?? []).some(
        (row) =>
          row.preferred === true &&
          typeof row.languageTag === "string" &&
          (row.languageTag === language ||
            row.languageTag.startsWith(`${language}-`)) &&
          (taxon
            ? typeof taxonId === "string" &&
              same(row.subject, { type: "taxon", id: taxonId })
            : same(row.subject, { type: target.kind, id: subject.id })) &&
          decisions.some(
            (decision) =>
              decision.kind === "localization" &&
              decision.disposition === "accept" &&
              records(decision.records).some(
                (item) => item.id === row.id && same(item.value, row),
              ),
          ),
      );
    return {
      id: target.id,
      kind: target.kind,
      label: target.label,
      subjectId: bound ? subject.id : null,
      identity: linked,
      frenchPreferredName: localized("fr"),
      englishPreferredName: localized("en"),
      taxonFrenchPreferredName: localized("fr", true),
      taxonEnglishPreferredName: localized("en", true),
      coldSensitivity: facts.some(
        (row) => row.predicate === "frost_sensitivity" && rightsEligible(row),
      ),
      plantingWindow: facts.some(
        (row) =>
          (["sowing_window", "transplant_window"].includes(
            String(row.predicate),
          ) ||
            (row.predicate === "cultivation_window" &&
              [
                "start_indoors",
                "direct_sow",
                "transplant",
                "plant",
                "establish_outdoors",
              ].includes(text(object(row.value).action)))) &&
          rightsEligible(row),
      ),
      commercialAssertions: facts.filter(rightsEligible).length,
      growingSystems: [
        ...new Set(
          facts
            .filter(rightsEligible)
            .flatMap(
              (row) =>
                dataset?.contexts
                  .filter((context) => context.id === row.contextId)
                  .map((context) => context.growingSystem) ?? [],
            ),
        ),
      ].sort(),
      cultivarOnlyEvidence:
        target.kind === "plant-concept" &&
        bound &&
        facts.length === 0 &&
        (dataset?.cultivars ?? []).some(
          (cultivar) =>
            cultivar.plantConceptId === subject.id &&
            liveAssertions.some((row) =>
              same(row.subject, { type: "cultivar", id: cultivar.id }),
            ),
        ),
    };
  });
  const cohorts = { grow: cohort("grow"), cropgraph: cohort("cropgraph") };
  const comparisonCoverage = count(
    available
      ? draft.comparisons.map((row) =>
          comparisonsById.has(row.id)
            ? comparisonsById.get(row.id)!.decision === "defer"
              ? "defer"
              : "accept"
            : "pending",
        )
      : undefined,
  );
  const reasons: string[] = [];
  for (const [name, dimension] of Object.entries(dimensions))
    if (dimension.valid !== true) reasons.push(`${name}: ${dimension.status}`);
  if (!available) reasons.push("Coverage unavailable");
  for (const [kind, value] of Object.entries(cohorts)) {
    if (value.records !== (kind === "grow" ? 140 : 5006))
      reasons.push(`${kind}: pinned source denominator incomplete`);
    for (const [name, valueCount] of Object.entries({
      identity: value.identity,
      subject: value.subject,
      ...value.candidates,
      commercialRights: value.commercialRights,
      contexts: value.contexts,
    }))
      if (valueCount.pending !== 0)
        reasons.push(`${kind}/${name}: pending or unavailable`);
  }
  if (comparisonCoverage.pending !== 0)
    reasons.push("Comparisons pending or unavailable");
  if (uncoveredDeferrals.length > 0)
    reasons.push("Deferrals without reviewed accepted limitations");
  if (issues.some((row) => row.status === "open"))
    reasons.push("Open curation issues");
  if (
    issues.some(
      (row) =>
        row.status === "accepted-limitation" && !limitations.includes(row),
    )
  )
    reasons.push("Accepted limitations lack current reviewed issue decisions");
  if (
    delivery.filter((row) => row.kind === "plant-concept").length !== 33 ||
    delivery.filter((row) => row.kind === "cultivar").length !== 2
  )
    reasons.push("Delivery target denominators differ from ADR-0005");
  if (delivery.some((row) => !row.identity))
    reasons.push("Delivery targets lack reviewed subject/identity bindings");
  if (
    delivery.some(
      (row) =>
        row.kind === "plant-concept" &&
        (!row.coldSensitivity || !row.plantingWindow) &&
        !limited(String(row.id)),
    )
  )
    reasons.push(
      "MVP cold sensitivity or planting coverage lacks facts or reviewed limitations",
    );
  return {
    policy: "c4-readiness-v1",
    available,
    targetSha256: contentDigest(targetFile),
    cohorts,
    delivery: {
      concepts: delivery.filter((row) => row.kind === "plant-concept").length,
      cultivarExemplars: delivery.filter((row) => row.kind === "cultivar")
        .length,
      targets: delivery,
    },
    comparisons: comparisonCoverage,
    conflicts: available
      ? draft.comparisons.filter(
          (row) => row.outcome === "conflict" || row.result === "conflict",
        ).length
      : null,
    acceptedLimitations: limitations.map((row) => field(row, "id")).sort(),
    uncoveredDeferrals: [
      ...new Set(uncoveredDeferrals.map((row) => field(row, "id"))),
    ].sort(),
    readiness: {
      status:
        reasons.length === 0
          ? "validated"
          : Object.values(dimensions).some(
                (dimension) => dimension.valid === false,
              )
            ? "blocked"
            : "in progress",
      ready: reasons.length === 0,
      reasons,
    },
    handoff: {
      status: "planned",
      boundary:
        "C5 selects current explicitly reviewed authoring records and applies profile, rights, supersession and inheritance gates; C4 readiness does not approve a release.",
    },
  };
}

function count(dispositions: readonly string[] | undefined): CoverageCount {
  if (dispositions === undefined)
    return {
      total: null,
      accepted: 0,
      rejected: 0,
      deferred: 0,
      pending: null,
    };
  return {
    total: dispositions.length,
    accepted: dispositions.filter((value) => value === "accept").length,
    rejected: dispositions.filter((value) => value === "reject").length,
    deferred: dispositions.filter((value) => value === "defer").length,
    pending: dispositions.filter(
      (value) => !["accept", "reject", "defer"].includes(value),
    ).length,
  };
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "unspecified";
}

function optionalObject(value: unknown): RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? object(value)
    : {};
}
