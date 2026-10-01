import { createHash } from "node:crypto";
import {
  createAssertionComparison,
  type AssertionComparison,
  type AssertionComparisonCandidate,
} from "../domain/assertion-comparisons.js";
import {
  makeSemanticSubrecordKey,
  type QualifiedSourceRecordKey,
  type SemanticSubrecordKey,
} from "../domain/source-keys.js";
import { serializeCanonicalJson } from "../serialization/canonical-json.js";

type RecordValue = Readonly<Record<string, unknown>>;

export interface IntegratedComparison extends AssertionComparison {
  readonly matchEvidence: {
    readonly kind: "shared-wfo-and-common-name-proposal";
    readonly wfoIdentifier: string;
    readonly normalizedCommonName: string;
    readonly subjectReviewState: "unreviewed";
  };
  readonly dimensions: Readonly<
    Record<
      "predicate" | "action" | "timing" | "geography" | "growingSystem",
      "same" | "different" | "unresolved"
    >
  >;
  readonly sharedUpstreamEvidence: {
    readonly status: "possible" | "unknown";
    readonly cropGraphCitation: string;
  };
}

export interface ComparisonPacket {
  readonly id: string;
  readonly sourceKind: "grow" | "cropgraph";
  readonly sourceRecordKey: QualifiedSourceRecordKey;
  readonly sourceRecord: RecordValue;
  readonly taxonomyOutcomes: readonly RecordValue[];
  readonly cultivationCandidates: readonly RecordValue[];
}

/** Shared taxonomy only nominates a review pair; it never maps a subject. */
export function compareIntegratedPackets(
  packets: readonly ComparisonPacket[],
): {
  readonly comparisons: readonly IntegratedComparison[];
  readonly idsByPacket: ReadonlyMap<string, readonly string[]>;
} {
  const cropByWfoAndName = new Map<string, ComparisonPacket[]>();
  for (const packet of packets.filter(
    (item) => item.sourceKind === "cropgraph",
  )) {
    const name = commonName(packet);
    if (name === undefined) continue;
    for (const identifier of uniqueWfoIdentifiers(packet)) {
      const key = JSON.stringify([identifier, name]);
      const matches = cropByWfoAndName.get(key) ?? [];
      matches.push(packet);
      cropByWfoAndName.set(key, matches);
    }
  }
  const comparisons = new Map<string, IntegratedComparison>();
  const idsByPacket = new Map<string, Set<string>>();
  for (const grow of packets.filter((item) => item.sourceKind === "grow")) {
    const name = commonName(grow);
    if (name === undefined) continue;
    for (const identifier of uniqueWfoIdentifiers(grow)) {
      for (const crop of cropByWfoAndName.get(
        JSON.stringify([identifier, name]),
      ) ?? []) {
        for (const growClaim of grow.cultivationCandidates) {
          for (const cropClaim of crop.cultivationCandidates) {
            if (!potentiallyRelated(growClaim, cropClaim)) continue;
            const result = compareClaims(
              growClaim,
              cropClaim,
              crop,
              identifier,
              name,
            );
            const previous = comparisons.get(result.id);
            if (
              previous !== undefined &&
              serializeCanonicalJson(previous).toString() !==
                serializeCanonicalJson(result).toString()
            )
              throw new Error(
                `Comparison ${result.id} has inconsistent evidence`,
              );
            comparisons.set(result.id, result);
            for (const packetId of [grow.id, crop.id]) {
              const ids = idsByPacket.get(packetId) ?? new Set<string>();
              ids.add(result.id);
              idsByPacket.set(packetId, ids);
            }
          }
        }
      }
    }
  }
  return {
    comparisons: [...comparisons.values()].sort((a, b) =>
      a.id.localeCompare(b.id),
    ),
    idsByPacket: new Map(
      [...idsByPacket].map(([id, values]) => [id, [...values].sort()]),
    ),
  };
}

function uniqueWfoIdentifiers(packet: ComparisonPacket): string[] {
  const found = new Set<string>();
  for (const record of packet.taxonomyOutcomes) {
    if (
      !["candidate-accepted", "candidate-synonym"].includes(
        String(record.outcome),
      )
    )
      return [];
    const alternatives = array(record.alternatives)
      .map(object)
      .filter((item): item is RecordValue => item !== undefined);
    if (alternatives.length !== 1) return [];
    const alternative = alternatives[0]!;
    const accepted = object(alternative.acceptedName) ?? alternative;
    const external = object(accepted.externalIdentifier);
    if (
      typeof external?.identifier !== "string" ||
      external.identifier.length === 0
    )
      return [];
    found.add(external.identifier);
  }
  return found.size === 1 ? [...found] : [];
}

function commonName(packet: ComparisonPacket): string | undefined {
  const raw =
    packet.sourceKind === "grow"
      ? object(packet.sourceRecord.fields)?.["Common name"]
      : object(packet.sourceRecord.rawEntry)?.commonName;
  if (typeof raw !== "string") return undefined;
  const normalized = raw
    .normalize("NFC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("en");
  return normalized.length > 0 ? normalized : undefined;
}

function potentiallyRelated(grow: RecordValue, crop: RecordValue): boolean {
  if (grow.predicate === "days_to_first_harvest")
    return crop.kind === "harvest-range";
  if (grow.predicate !== "calendar_window" || crop.kind !== "window")
    return false;
  const growAction = object(grow.normalizedValue)?.action;
  const cropValue = object(crop.value);
  const cropAction = cropValue?.sourceAction ?? cropValue?.action;
  if (growAction === "indoors_or_undercover")
    return cropAction === "start_indoors";
  if (growAction === "outdoor_sowing_or_planting")
    return ["direct_sow", "transplant", "plant_now"].includes(
      String(cropAction),
    );
  return typeof growAction === "string" && growAction === cropAction;
}

function compareClaims(
  grow: RecordValue,
  crop: RecordValue,
  cropPacket: ComparisonPacket,
  wfoIdentifier: string,
  normalizedCommonName: string,
): IntegratedComparison {
  const growValue = object(grow.normalizedValue);
  const cropValue = object(crop.value);
  const growApplicability = object(grow.applicability);
  const dimensions: IntegratedComparison["dimensions"] = {
    predicate: "same",
    action: actionDimension(grow, cropValue),
    timing: timingDimension(grow, growValue, cropValue),
    geography: geographyDimension(growApplicability, crop),
    growingSystem: systemDimension(growApplicability, cropPacket),
  };
  const scopeComparable = [
    dimensions.predicate,
    dimensions.action,
    dimensions.geography,
    dimensions.growingSystem,
  ].every((value) => value === "same");
  const comparable = scopeComparable && dimensions.timing !== "unresolved";
  const outcome = !comparable
    ? "not-comparable"
    : dimensions.timing === "different"
      ? "conflict"
      : "agreement";
  const reason = !comparable
    ? `Provisional subject link; incompatible or unresolved ${Object.entries(
        dimensions,
      )
        .filter(([, value]) => value !== "same")
        .map(([key]) => key)
        .join(", ")}.`
    : outcome === "conflict"
      ? "The claims have comparable scope but disagree on timing."
      : "The claims agree on comparable predicate, action, timing, geography and growing system.";
  const citation =
    typeof crop.effectiveCitation === "string"
      ? crop.effectiveCitation
      : "unknown";
  const possibleSharedUpstream =
    /(?:university of dundee|10\.15132\/10000157|\bgrow\b)/iu.test(citation);
  return {
    ...createAssertionComparison({
      outcome,
      candidates: [growReference(grow), cropReference(crop)],
      reason,
    }),
    matchEvidence: {
      kind: "shared-wfo-and-common-name-proposal",
      wfoIdentifier,
      normalizedCommonName,
      subjectReviewState: "unreviewed",
    },
    dimensions,
    sharedUpstreamEvidence: {
      status: possibleSharedUpstream ? "possible" : "unknown",
      cropGraphCitation: citation,
    },
  };
}

function growReference(claim: RecordValue): AssertionComparisonCandidate {
  const recordKey = object(claim.sourceRecordKey) as
    QualifiedSourceRecordKey | undefined;
  if (recordKey === undefined)
    throw new Error("GROW claim lacks a qualified record key");
  const predicate = String(claim.predicate);
  const semantic = {
    predicate,
    rawValue: claim.rawValue,
    normalizedValue: claim.normalizedValue,
    applicability: claim.applicability,
  };
  const digest = createHash("sha256")
    .update(serializeCanonicalJson(semantic))
    .digest("hex");
  return {
    candidateId: requiredString(claim, "id"),
    sourceClaimKey: makeSemanticSubrecordKey(recordKey, [
      { kind: "field", id: predicate },
      { kind: "claim", id: digest },
    ]),
    sourceClaim: claim,
  };
}

function cropReference(claim: RecordValue): AssertionComparisonCandidate {
  const key = object(claim.sourceClaimKey) as SemanticSubrecordKey | undefined;
  if (key === undefined)
    throw new Error("CropGraph claim lacks a semantic key");
  return {
    candidateId: requiredString(claim, "id"),
    sourceClaimKey: key,
    sourceClaim: claim,
  };
}

function actionDimension(
  grow: RecordValue,
  cropValue: RecordValue | undefined,
): "same" | "different" | "unresolved" {
  if (grow.predicate === "days_to_first_harvest") return "same";
  const growAction = object(grow.normalizedValue)?.action;
  const cropAction = cropValue?.action;
  if (typeof growAction !== "string" || typeof cropAction !== "string")
    return "unresolved";
  if (
    [
      "outdoor_sowing_or_planting",
      "indoors_or_undercover",
      "plant_now",
    ].includes(growAction)
  )
    return "unresolved";
  return growAction === cropAction ? "same" : "different";
}

function timingDimension(
  grow: RecordValue,
  growValue: RecordValue | undefined,
  cropValue: RecordValue | undefined,
): "same" | "different" | "unresolved" {
  if (grow.predicate === "days_to_first_harvest") {
    const growAnchor = growValue?.anchor;
    const cropAnchor = cropValue?.anchor;
    if (
      growAnchor === "unspecified-in-source" ||
      cropAnchor === "unknown" ||
      growAnchor === undefined ||
      cropAnchor === undefined
    )
      return "unresolved";
    if (growAnchor !== cropAnchor) return "unresolved";
    const duration = object(growValue?.duration);
    if (
      duration === undefined ||
      cropValue === undefined ||
      typeof duration.minimum !== "number" ||
      typeof duration.maximum !== "number" ||
      typeof cropValue.minimum !== "number" ||
      typeof cropValue.maximum !== "number" ||
      typeof duration.unit !== "string" ||
      typeof cropValue.unit !== "string"
    )
      return "unresolved";
    return equivalent(
      {
        minimum: duration.minimum,
        maximum: duration.maximum,
        unit: duration.unit,
      },
      {
        minimum: cropValue.minimum,
        maximum: cropValue.maximum,
        unit: cropValue.unit,
      },
    )
      ? "same"
      : "different";
  }
  const growTiming = growValue;
  const cropTiming = object(cropValue?.timing);
  if (!growTiming || !cropTiming || growTiming.type !== cropTiming.type)
    return "unresolved";
  if (
    growTiming.type === "relative-day-window" &&
    growTiming.anchor !== cropTiming.anchor
  )
    return "unresolved";
  if (growTiming.type === "relative-day-window") {
    if (
      typeof growTiming.startOffsetDays !== "number" ||
      typeof growTiming.endOffsetDays !== "number" ||
      typeof cropTiming.startOffsetDays !== "number" ||
      typeof cropTiming.endOffsetDays !== "number"
    )
      return "unresolved";
    return equivalent(
      {
        startOffsetDays: growTiming.startOffsetDays,
        endOffsetDays: growTiming.endOffsetDays,
      },
      {
        startOffsetDays: cropTiming.startOffsetDays,
        endOffsetDays: cropTiming.endOffsetDays,
      },
    )
      ? "same"
      : "different";
  }
  if (growTiming.type === "calendar-date-window") {
    if (
      !object(growTiming.start) ||
      !object(growTiming.end) ||
      !object(cropTiming.start) ||
      !object(cropTiming.end) ||
      typeof growTiming.crossesYearBoundary !== "boolean" ||
      typeof cropTiming.crossesYearBoundary !== "boolean"
    )
      return "unresolved";
    return equivalent(
      {
        start: growTiming.start,
        end: growTiming.end,
        crossesYearBoundary: growTiming.crossesYearBoundary,
      },
      {
        start: cropTiming.start,
        end: cropTiming.end,
        crossesYearBoundary: cropTiming.crossesYearBoundary,
      },
    )
      ? "same"
      : "different";
  }
  return "unresolved";
}

function geographyDimension(
  grow: RecordValue | undefined,
  crop: RecordValue,
): "same" | "different" | "unresolved" {
  const country = object(grow?.geography)?.country;
  const cropGeography = object(object(crop.value)?.geography);
  if (typeof country !== "string" || typeof cropGeography?.country !== "string")
    return "unresolved";
  return country === cropGeography.country ? "same" : "different";
}

function systemDimension(
  grow: RecordValue | undefined,
  cropPacket: ComparisonPacket,
): "same" | "different" | "unresolved" {
  const growSystem = grow?.growingSystem;
  const cropSystem = cropPacket.cultivationCandidates
    .filter((candidate) => candidate.kind === "context")
    .map((candidate) => object(candidate.value)?.growingContext)
    .find((value) => typeof value === "string");
  if (
    typeof growSystem !== "string" ||
    typeof cropSystem !== "string" ||
    growSystem === "unknown" ||
    cropSystem === "unknown"
  )
    return "unresolved";
  return growSystem === cropSystem ? "same" : "different";
}

function equivalent(left: unknown, right: unknown): boolean {
  return (
    serializeCanonicalJson(left).toString() ===
    serializeCanonicalJson(right).toString()
  );
}

function requiredString(record: RecordValue, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`Claim has no ${field}`);
  return value;
}

function object(value: unknown): RecordValue | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : undefined;
}

function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}
