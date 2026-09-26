import { createHash } from "node:crypto";
import {
  makeSemanticSubrecordKey,
  serializeSemanticSubrecordKey,
} from "../../domain/source-keys.js";
import { serializeCanonicalJson } from "../../serialization/canonical-json.js";
import type {
  CropGraphCandidate,
  CropGraphDiagnostic,
  CropGraphRawRecord,
  CultivationKind,
  IdentityKind,
} from "./types.js";

/** Pure extraction from a schema-validated raw record. No subject matching or acceptance. */
export function extractCropGraphCandidates(record: CropGraphRawRecord) {
  const entry = record.rawEntry;
  const candidates = new Map<string, CropGraphCandidate>();
  const diagnostics: CropGraphDiagnostic[] = [];
  const locator = (field: string) => `${record.sourceLocator}/${field}`;
  const warn = (
    code: string,
    message: string,
    sourceLocator: string,
    details: Record<string, unknown> = {},
  ) => {
    diagnostics.push({
      kind: "warning",
      code,
      message,
      sourceRecordKey: record.sourceRecordKey,
      sourceLocator,
      details,
    });
  };
  const add = (
    kind: CropGraphCandidate["kind"],
    semanticField: string,
    rawValue: unknown,
    value: Record<string, unknown>,
    sourceLocators: string[],
    mappingMethod: CropGraphCandidate["mappingMethod"] = "source-preserved",
    relatedCandidateIds: string[] = [],
  ) => {
    const sourceClaimKey = makeSemanticSubrecordKey(record.sourceRecordKey, [
      { kind: "field", id: semanticField },
      { kind: "claim", id: hash({ kind, rawValue, value, mappingMethod }) },
    ]);
    const id = `candidate_${hash(serializeSemanticSubrecordKey(sourceClaimKey))}`;
    const previous = candidates.get(id);
    if (previous !== undefined) {
      previous.sourceLocators.push(
        ...sourceLocators.filter(
          (path) => !previous.sourceLocators.includes(path),
        ),
      );
      warn(
        "DUPLICATE_SEMANTIC_CLAIM",
        "Identical source claims share one candidate; all occurrence locators are retained.",
        sourceLocators[0]!,
        { candidateId: id },
      );
      return previous;
    }
    const candidate: CropGraphCandidate = {
      id,
      kind,
      sourceRecordKey: record.sourceRecordKey,
      sourceClaimKey,
      sourceLocators,
      rawValue,
      value,
      mappingMethod,
      relatedCandidateIds: [...new Set(relatedCandidateIds)].sort(),
      reviewState: "unreviewed",
      effectiveCitation: record.effectiveCitation,
      citationLevel: record.citationLevel,
      citationLocator:
        record.citationLevel === "entry"
          ? locator("source")
          : `${record.sourceLocator.split("#")[0]}#/source`,
      licenceId: "licence_cropgraph_data_declared_cc_by_4_0",
      declaredLicence: record.declaredLicence,
      commercialRights: "pending-review",
    };
    candidates.set(id, candidate);
    return candidate;
  };
  const note = (
    text: string | undefined,
    field: string,
    semanticField: string,
    related: string[] = [],
    climate?: string,
  ) => {
    if (text === undefined) return;
    const candidate = add(
      "note",
      semanticField,
      text,
      { text, ...(climate === undefined ? {} : { climate }) },
      [locator(field)],
      "source-preserved",
      related,
    );
    // These are review flags, not inferred geographic or horticultural assertions.
    if (
      /\b(?:long-day|short-day|day-length|California|southeast|southwest)\b|°\s*N\b/iu.test(
        text,
      )
    ) {
      warn(
        "REGIONAL_NOTE_REQUIRES_REVIEW",
        "Source regional or day-length restrictions require applicability review.",
        locator(field),
        { candidateId: candidate.id, text },
      );
    }
  };

  add(
    "scientific-name",
    "scientificName",
    entry.scientificName,
    { text: entry.scientificName, nameRole: "source-scientific-label" },
    [locator("scientificName")],
  );
  add(
    "common-name",
    "commonName",
    entry.commonName,
    { text: entry.commonName, language: "unknown" },
    [locator("commonName")],
  );
  for (const [index, alias] of (entry.aliases ?? []).entries()) {
    add(
      "alias",
      "aliases",
      alias,
      { text: alias, language: "unknown", nameRole: "unknown" },
      [locator(`aliases/${index}`)],
    );
  }
  // Always preserve the entire source subject label. No stripped name becomes a taxon.
  const hints: { scope: string; label: string; sourceField: string }[] = [];
  const cultivar = /^(.+?)\s+['‘]([^'’]+)['’]$/u.exec(entry.scientificName);
  if (cultivar)
    hints.push({
      scope: "cultivar",
      label: cultivar[2]!,
      sourceField: "scientificName",
    });
  const microgreenName = /\bmicrogreens?\b/iu.test(entry.commonName);
  if (microgreenName || /^microgreen-/u.test(entry.slug))
    hints.push({
      scope: "microgreen",
      label: microgreenName ? entry.commonName : entry.slug,
      sourceField: microgreenName ? "commonName" : "slug",
    });
  if (entry.category === "sprout" && /\bsprouts?\b/iu.test(entry.commonName))
    hints.push({
      scope: "sprout",
      label: entry.commonName,
      sourceField: "commonName",
    });
  if (/\b(?:mix|mixture|blend)\b/iu.test(entry.commonName))
    hints.push({
      scope: "mixture",
      label: entry.commonName,
      sourceField: "commonName",
    });
  if (/\b(?:var\.|subsp\.|Group)\s+/u.test(entry.scientificName))
    hints.push({
      scope: "crop-form",
      label: entry.scientificName,
      sourceField: "scientificName",
    });
  add(
    "subject-label",
    "subject-label",
    {
      slug: entry.slug,
      commonName: entry.commonName,
      scientificName: entry.scientificName,
      category: entry.category,
    },
    {
      commonName: entry.commonName,
      scientificName: entry.scientificName,
      resolution: "unresolved",
      hints,
    },
    [
      locator("slug"),
      locator("commonName"),
      locator("scientificName"),
      locator("category"),
    ],
    "explicit-label",
  );

  const context = add(
    "context",
    "growingContext",
    entry.growingContext ?? null,
    {
      growingContext: entry.growingContext ?? "unknown",
      presence: entry.growingContext === undefined ? "absent" : "present",
      heating: "unknown",
      geographicApplicability: "unreviewed",
    },
    [
      entry.growingContext === undefined
        ? record.sourceLocator
        : locator("growingContext"),
    ],
  );
  if (entry.growingContext === "greenhouse")
    warn(
      "GREENHOUSE_HEATING_UNKNOWN",
      "Greenhouse context does not establish heating or frost protection.",
      locator("growingContext"),
      { candidateId: context.id },
    );
  if (entry.growingContext === undefined)
    warn(
      "GROWING_CONTEXT_ABSENT",
      "No outdoor default is inferred for an absent growing context.",
      record.sourceLocator,
      { candidateId: context.id },
    );
  for (const field of ["category", "season", "zoneRange"] as const) {
    add(
      "classification",
      field,
      entry[field],
      { field, sourceValue: entry[field] },
      [locator(field)],
    );
  }
  const harvest = add(
    "harvest-range",
    "daysToHarvest",
    entry.daysToHarvest,
    {
      minimum: entry.daysToHarvest.min,
      maximum: entry.daysToHarvest.max,
      unit: "d",
      anchor: "unknown",
    },
    [locator("daysToHarvest")],
  );
  warn(
    "HARVEST_ANCHOR_UNKNOWN",
    "The source range does not establish a unique sowing, transplanting or establishment anchor.",
    locator("daysToHarvest"),
    { candidateId: harvest.id },
  );
  if (entry.minSoilTempF !== undefined) {
    const soil = add(
      "soil-temperature",
      "minSoilTempF",
      entry.minSoilTempF,
      {
        value: entry.minSoilTempF,
        unit: "[degF]",
        interpretation: "unresolved",
      },
      [locator("minSoilTempF")],
    );
    if (entry.minSoilTempF !== null)
      warn(
        "SOIL_TEMPERATURE_MEANING_UNRESOLVED",
        "The source field is preserved without choosing germination or transplant applicability.",
        locator("minSoilTempF"),
        { candidateId: soil.id },
      );
  }

  const windows = entry.windows.map((window, index) => {
    const candidate = add(
      "window",
      "windows",
      window,
      {
        sourceAction: window.action,
        action: window.action === "plant_now" ? null : window.action,
        actionMapping:
          window.action === "plant_now" ? "unresolved" : "identity",
        sourceTiming: {
          anchor: window.anchor,
          fromFrostDays: window.fromFrostDays,
          toFrostDays: window.toFrostDays,
        },
        timing: {
          type: "relative-day-window",
          anchor:
            window.anchor === "last_spring"
              ? "last_spring_frost"
              : "first_autumn_frost",
          startOffsetDays: window.fromFrostDays,
          endOffsetDays: window.toFrostDays,
        },
        applicability: "unreviewed",
      },
      [locator(`windows/${index}`)],
      "normalized-source-timing",
      [context.id],
    );
    if (window.action === "plant_now")
      warn(
        "ACTION_MEANING_UNRESOLVED",
        "plant_now remains source-native; no catalog action is inferred.",
        locator(`windows/${index}/action`),
        { candidateId: candidate.id },
      );
    // Only an explicit N-M weeks before last/first frost phrase is compared.
    const match =
      /\b(\d+)\s*[-–]\s*(\d+)\s+weeks?\s+before\s+(?:the\s+)?(last|first)\s+frost\b/iu.exec(
        window.notes ?? "",
      );
    if (
      match &&
      (match[3]!.toLowerCase() === "last") === (window.anchor === "last_spring")
    ) {
      const noteStart = -Number(match[2]) * 7;
      const noteEnd = -Number(match[1]) * 7;
      if (noteStart !== window.fromFrostDays || noteEnd !== window.toFrostDays)
        warn(
          "WINDOW_NOTE_RANGE_DISAGREEMENT",
          "The explicit note range differs from the numeric window; neither claim overrides the other.",
          locator(`windows/${index}`),
          {
            candidateId: candidate.id,
            numericRange: [window.fromFrostDays, window.toFrostDays],
            noteRangeDays: [noteStart, noteEnd],
            note: window.notes,
          },
        );
    }
    if (entry.growingContext === "indoor")
      warn(
        "INDOOR_FROST_APPLICABILITY_UNRESOLVED",
        "An indoor entry carries a frost-relative window; applicability requires review.",
        locator(`windows/${index}`),
        { candidateId: candidate.id },
      );
    note(
      window.notes,
      `windows/${index}/notes`,
      `window-note:${candidate.id}`,
      [candidate.id],
    );
    return { action: window.action, id: candidate.id };
  });
  note(entry.notes, "notes", "notes");
  for (const [climate, modifier] of Object.entries(
    entry.climateModifiers ?? {},
  ).sort(([a], [b]) => compare(a, b))) {
    const modifierIds: string[] = [];
    for (const [action, weeks] of Object.entries(
      modifier.windowShifts ?? {},
    ).sort(([a], [b]) => compare(a, b))) {
      const bases = [
        ...new Set(
          windows
            .filter((window) => window.action === action)
            .map((window) => window.id),
        ),
      ].sort();
      const field = `climateModifiers/${climate}/windowShifts/${action}`;
      const candidate = add(
        "modifier",
        `modifier:${climate}:${action}`,
        weeks,
        {
          climate,
          sourceAction: action,
          shiftWeeks: weeks,
          application: "unapplied",
          baseWindowCandidateIds: bases,
        },
        [locator(field)],
        "source-preserved",
        bases,
      );
      modifierIds.push(candidate.id);
      if (bases.length !== 1)
        warn(
          bases.length === 0
            ? "MODIFIER_BASE_MISSING"
            : "MODIFIER_BASE_AMBIGUOUS",
          "The action-keyed modifier requires explicit base-window selection.",
          locator(field),
          { candidateId: candidate.id, baseWindowCandidateIds: bases },
        );
      if (action === "plant_now")
        warn(
          "ACTION_MEANING_UNRESOLVED",
          "The pinned plant_now modifier remains uninterpreted.",
          locator(field),
          { candidateId: candidate.id },
        );
    }
    note(
      modifier.notes,
      `climateModifiers/${climate}/notes`,
      `modifier-note:${climate}`,
      modifierIds,
      climate,
    );
  }
  if (record.citationLevel === "calendar")
    warn(
      "ENTRY_CITATION_ABSENT",
      "The entry inherits the calendar bibliography; an exact supporting work still requires review.",
      record.sourceLocator,
      { effectiveCitation: record.effectiveCitation },
    );
  if (!record.effectiveCitation.trim())
    warn(
      "CITATION_UNUSABLE",
      "An empty or whitespace-only effective citation does not identify a supporting work.",
      record.sourceLocator,
    );
  const sorted = [...candidates.values()].sort((a, b) => compare(a.id, b.id));
  for (const candidate of sorted) candidate.sourceLocators.sort();
  diagnostics.sort((a, b) => compare(canonical(a), canonical(b)));
  return {
    identity: sorted.filter(
      (candidate): candidate is CropGraphCandidate<IdentityKind> =>
        ["scientific-name", "common-name", "alias", "subject-label"].includes(
          candidate.kind,
        ),
    ),
    cultivation: sorted.filter(
      (candidate): candidate is CropGraphCandidate<CultivationKind> =>
        !["scientific-name", "common-name", "alias", "subject-label"].includes(
          candidate.kind,
        ),
    ),
    diagnostics,
  };
}

function canonical(value: unknown): string {
  return Buffer.from(serializeCanonicalJson(value)).toString("utf8");
}
function hash(value: unknown): string {
  return createHash("sha256")
    .update(serializeCanonicalJson(value))
    .digest("hex");
}
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
