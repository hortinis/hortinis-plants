import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { extractCropGraphCandidates } from "../../src/adapters/cropgraph/candidates.js";
import type {
  CropGraphCandidate,
  CropGraphEntry,
  CropGraphRawRecord,
} from "../../src/adapters/cropgraph/types.js";
import { validate } from "../../src/schema/validation-api.js";

const fixture = JSON.parse(
  await readFile("test/fixtures/cropgraph/entries.json", "utf8"),
) as {
  sourceReleaseId: string;
  calendarCitation: string;
  entries: CropGraphEntry[];
};
function raw(
  slug = "tomato",
  changes: Partial<CropGraphEntry> = {},
): CropGraphRawRecord {
  const entry = {
    ...fixture.entries.find((entry) => entry.slug === slug)!,
    ...changes,
  };
  return {
    sourceRecordKey: {
      source: {
        sourceId: "source_cropgraph",
        sourceManifestId: "source_manifest_cropgraph",
        sourceReleaseId: fixture.sourceReleaseId,
      },
      recordId: entry.slug,
    },
    sourceLocator: "packages/core/src/data/crop-calendar.json#/entries/0",
    originalIndex: 0,
    rawEntry: entry,
    effectiveCitation: entry.source ?? fixture.calendarCitation,
    citationLevel: entry.source === undefined ? "calendar" : "entry",
    declaredLicence: "CC-BY-4.0",
    commercialRights: "pending-review",
  };
}
function ofKind(
  candidates: readonly CropGraphCandidate[],
  kind: CropGraphCandidate["kind"],
) {
  return candidates.filter((candidate) => candidate.kind === kind);
}

describe("CropGraph candidate extraction", () => {
  it("preserves tomato's conflicting numeric and note windows and negative frost offsets", () => {
    const result = extractCropGraphCandidates(raw());
    const window = ofKind(result.cultivation, "window").find(
      (c) => c.value.sourceAction === "start_indoors",
    )!;
    expect(window.value).toMatchObject({
      action: "start_indoors",
      actionMapping: "identity",
      timing: {
        anchor: "last_spring_frost",
        startOffsetDays: -56,
        endOffsetDays: -28,
      },
    });
    expect(
      result.diagnostics.find(
        (d) => d.code === "WINDOW_NOTE_RANGE_DISAGREEMENT",
      )?.details,
    ).toMatchObject({ numericRange: [-56, -28], noteRangeDays: [-56, -42] });
    expect(
      result.cultivation.some(
        (c) =>
          c.kind === "note" &&
          c.rawValue === "6-8 weeks before last frost; 70-75°F germination" &&
          c.relatedCandidateIds.includes(window.id),
      ),
    ).toBe(true);
    expect(ofKind(result.cultivation, "soil-temperature")[0]?.value).toEqual({
      value: 60,
      unit: "[degF]",
      interpretation: "unresolved",
    });
    expect(ofKind(result.cultivation, "harvest-range")[0]?.value).toEqual({
      minimum: 55,
      maximum: 90,
      unit: "d",
      anchor: "unknown",
    });
    expect(result.identity.find((c) => c.rawValue === "tomate")?.value).toEqual(
      { text: "tomate", language: "unknown", nameRole: "unknown" },
    );
  });

  it("retains onion regional notes and notes-only modifiers without transferring geography", () => {
    const record = raw("onion");
    const result = extractCropGraphCandidates(record);
    expect(
      result.diagnostics.some(
        (d) => d.code === "REGIONAL_NOTE_REQUIRES_REVIEW",
      ),
    ).toBe(true);
    const notes = ofKind(result.cultivation, "note");
    expect(notes.some((c) => c.rawValue === record.rawEntry.notes)).toBe(true);
    const regional = notes.find((c) => c.value.climate === "mediterranean")!;
    expect(regional.value.text).toBe(
      record.rawEntry.climateModifiers!.mediterranean!.notes,
    );
    expect(regional.relatedCandidateIds).toEqual([]);
    expect(
      ofKind(result.cultivation, "context")[0]?.value.geographicApplicability,
    ).toBe("unreviewed");
  });

  it("keeps plant_now, greenhouse heating, missing context and harvest anchors unresolved", () => {
    const result = extractCropGraphCandidates(
      raw("rosemary-arp", { growingContext: "greenhouse" }),
    );
    expect(ofKind(result.cultivation, "window")[0]?.value).toMatchObject({
      sourceAction: "plant_now",
      action: null,
      actionMapping: "unresolved",
    });
    expect(ofKind(result.cultivation, "context")[0]?.value).toMatchObject({
      growingContext: "greenhouse",
      heating: "unknown",
    });
    expect(
      ofKind(result.cultivation, "soil-temperature")[0]?.value.value,
    ).toBeNull();
    expect(result.diagnostics.map((d) => d.code)).toContain(
      "ACTION_MEANING_UNRESOLVED",
    );
    const absent = raw();
    const entry = { ...absent.rawEntry };
    delete entry.growingContext;
    delete entry.minSoilTempF;
    const missing = extractCropGraphCandidates({ ...absent, rawEntry: entry });
    expect(ofKind(missing.cultivation, "context")[0]?.value).toMatchObject({
      growingContext: "unknown",
      presence: "absent",
    });
    expect(ofKind(missing.cultivation, "soil-temperature")).toHaveLength(0);
  });

  it("keeps cultivar, mixture and microgreen proposals distinct from generic labels", () => {
    for (const [slug, scope] of [
      ["rosemary-arp", "cultivar"],
      ["nasturtium-jewel-mix", "mixture"],
      ["microgreen-sunflower", "microgreen"],
    ]) {
      const result = extractCropGraphCandidates(raw(slug));
      const subject = ofKind(result.identity, "subject-label")[0]!;
      expect(subject.value.resolution).toBe("unresolved");
      expect(subject.value.hints).toEqual(
        expect.arrayContaining([expect.objectContaining({ scope })]),
      );
      expect(
        result.cultivation.every((c) => c.sourceRecordKey.recordId === slug),
      ).toBe(true);
      if (scope === "microgreen")
        expect(result.diagnostics.map((d) => d.code)).toContain(
          "INDOOR_FROST_APPLICABILITY_UNRESOLVED",
        );
    }
    const slugHint = extractCropGraphCandidates(
      raw("microgreen-sunflower", { commonName: "Sunflower Shoots" }),
    );
    const subject = ofKind(slugHint.identity, "subject-label")[0]!;
    expect(subject.value.hints).toEqual([
      {
        scope: "microgreen",
        label: "microgreen-sunflower",
        sourceField: "slug",
      },
    ]);
    expect(
      validate(
        "urn:hortinis:plants:schema:v1:cropgraph-identity-candidate",
        subject,
      ),
    ).toEqual({ valid: true });
    const pollmix = extractCropGraphCandidates(raw("seaberry-pollmix"));
    expect(ofKind(pollmix.identity, "subject-label")[0]?.value.hints).toEqual(
      [],
    );
    expect(
      ofKind(
        extractCropGraphCandidates(raw("lettuce-leaf")).identity,
        "subject-label",
      )[0]?.rawValue,
    ).toMatchObject({ commonName: "Leaf Lettuce" });
    const generic = extractCropGraphCandidates(
      raw("microgreen-sunflower", {
        slug: "sunflower",
        commonName: "Sunflower",
        category: "flower",
      }),
    );
    expect(ofKind(generic.identity, "subject-label")[0]?.value.hints).toEqual(
      [],
    );
  });

  it("preserves modifier lineage, including multiple and absent base windows, without applying shifts", () => {
    const record = raw();
    const result = extractCropGraphCandidates({
      ...record,
      rawEntry: {
        ...record.rawEntry,
        windows: [
          ...record.rawEntry.windows,
          {
            action: "transplant",
            anchor: "first_fall",
            fromFrostDays: -90,
            toFrostDays: -60,
          },
        ],
        climateModifiers: {
          maritime: { windowShifts: { transplant: -2, direct_sow: 1 } },
        },
      },
    });
    const modifier = ofKind(result.cultivation, "modifier").find(
      (c) => c.value.sourceAction === "transplant",
    )!;
    const bases = ofKind(result.cultivation, "window").filter(
      (c) => c.value.sourceAction === "transplant",
    );
    expect(modifier.value).toMatchObject({
      shiftWeeks: -2,
      application: "unapplied",
      baseWindowCandidateIds: bases.map((c) => c.id).sort(),
    });
    expect(modifier.relatedCandidateIds).toEqual(bases.map((c) => c.id).sort());
    expect(
      bases.find(
        (c) =>
          (c.value.timing as { anchor: string }).anchor ===
          "first_autumn_frost",
      )?.value.timing,
    ).toMatchObject({ startOffsetDays: -90, endOffsetDays: -60 });
    expect(result.diagnostics.map((d) => d.code)).toEqual(
      expect.arrayContaining([
        "MODIFIER_BASE_AMBIGUOUS",
        "MODIFIER_BASE_MISSING",
      ]),
    );
  });

  it("keeps IDs stable under reordering, qualifies sources and retains duplicate occurrence locators", () => {
    const record = raw();
    const duplicate = {
      ...record,
      rawEntry: {
        ...record.rawEntry,
        windows: [...record.rawEntry.windows, record.rawEntry.windows[0]!],
        aliases: ["tomate", "love apple", "tomate"],
      },
    };
    const first = extractCropGraphCandidates(duplicate);
    const second = extractCropGraphCandidates({
      ...duplicate,
      sourceLocator: "packages/core/src/data/crop-calendar.json#/entries/7",
      originalIndex: 7,
      rawEntry: {
        ...duplicate.rawEntry,
        windows: [...duplicate.rawEntry.windows].reverse(),
        aliases: [...duplicate.rawEntry.aliases].reverse(),
      },
    });
    expect(first.identity.map((c) => c.id)).toEqual(
      second.identity.map((c) => c.id),
    );
    expect(first.cultivation.map((c) => c.id)).toEqual(
      second.cultivation.map((c) => c.id),
    );
    expect(
      first.identity.find((c) => c.rawValue === "tomate")?.sourceLocators,
    ).toHaveLength(2);
    expect(
      ofKind(first.cultivation, "window").find(
        (c) => c.value.sourceAction === "start_indoors",
      )?.sourceLocators,
    ).toHaveLength(2);
    expect(first.diagnostics.map((d) => d.code)).toContain(
      "DUPLICATE_SEMANTIC_CLAIM",
    );
    const other = extractCropGraphCandidates({
      ...record,
      sourceRecordKey: {
        ...record.sourceRecordKey,
        source: { ...record.sourceRecordKey.source, sourceId: "source_other" },
      },
    });
    const ids = new Set(first.identity.map((c) => c.id));
    expect(other.identity.every((c) => !ids.has(c.id))).toBe(true);
    const changed = extractCropGraphCandidates({
      ...record,
      rawEntry: {
        ...record.rawEntry,
        windows: record.rawEntry.windows.map((w) => ({
          ...w,
          notes: "Changed note",
        })),
      },
    });
    const oldWindows = new Set(
      ofKind(first.cultivation, "window").map((c) => c.id),
    );
    expect(
      ofKind(changed.cultivation, "window").every((c) => !oldWindows.has(c.id)),
    ).toBe(true);
  });

  it("preserves citation inheritance and unusable entry citations without granting rights", () => {
    for (const source of [undefined, "", "   ", "Exact example citation"]) {
      const original = raw();
      const record =
        source === undefined ? original : raw("tomato", { source });
      const result = extractCropGraphCandidates(record);
      expect(
        validate("urn:hortinis:plants:schema:v1:cropgraph-raw-record", record),
      ).toEqual({ valid: true });
      expect(
        [...result.identity, ...result.cultivation].every(
          (c) =>
            c.reviewState === "unreviewed" &&
            c.commercialRights === "pending-review" &&
            c.effectiveCitation === record.effectiveCitation,
        ),
      ).toBe(true);
      expect(result.identity[0]?.citationLevel).toBe(
        source === undefined ? "calendar" : "entry",
      );
      expect(result.identity[0]?.citationLocator).toBe(
        source === undefined
          ? "packages/core/src/data/crop-calendar.json#/source"
          : `${record.sourceLocator}/source`,
      );
      expect(
        result.diagnostics.some((d) => d.code === "ENTRY_CITATION_ABSENT"),
      ).toBe(source === undefined);
      expect(
        result.diagnostics.some((d) => d.code === "CITATION_UNUSABLE"),
      ).toBe(source !== undefined && !source.trim());
    }
  });

  it("does not interpret note ranges anchored to transplant or a different frost season", () => {
    for (const notes of [
      "6-8 weeks before transplant",
      "6-8 weeks before first frost",
      "Regional advice without a numeric window",
    ]) {
      const record = raw();
      const result = extractCropGraphCandidates({
        ...record,
        rawEntry: {
          ...record.rawEntry,
          windows: [{ ...record.rawEntry.windows[0]!, notes }],
        },
      });
      expect(
        result.diagnostics.some(
          (d) => d.code === "WINDOW_NOTE_RANGE_DISAGREEMENT",
        ),
      ).toBe(false);
      expect(
        result.cultivation.some(
          (c) => c.kind === "note" && c.rawValue === notes,
        ),
      ).toBe(true);
    }
  });

  it("validates every emitted kind and rejects acceptance or semantic narrowing", () => {
    for (const entry of fixture.entries) {
      const result = extractCropGraphCandidates(raw(entry.slug));
      for (const [kind, candidates] of [
        ["identity", result.identity],
        ["cultivation", result.cultivation],
      ] as const) {
        const schema = `urn:hortinis:plants:schema:v1:cropgraph-${kind}-candidate`;
        for (const candidate of candidates) {
          expect(
            validate(schema, candidate),
            `${entry.slug}: ${candidate.kind}`,
          ).toEqual({ valid: true });
          expect(
            validate(schema, { ...candidate, reviewState: "accepted" }).valid,
          ).toBe(false);
          expect(
            validate(schema, { ...candidate, commercialRights: "eligible" })
              .valid,
          ).toBe(false);
          const related = new Set(
            [...result.identity, ...result.cultivation].map((c) => c.id),
          );
          expect(
            candidate.relatedCandidateIds.every((id) => related.has(id)),
          ).toBe(true);
        }
      }
    }
    const result = extractCropGraphCandidates(raw("rosemary-arp"));
    const window = ofKind(result.cultivation, "window")[0]!;
    expect(
      validate(
        "urn:hortinis:plants:schema:v1:cropgraph-cultivation-candidate",
        {
          ...window,
          value: {
            ...window.value,
            timing: {
              type: "relative-day-window",
              anchor: "previous_crop_harvest",
              startOffsetDays: -14,
              endOffsetDays: 28,
            },
          },
        },
      ).valid,
    ).toBe(false);
    for (const [kind, changes] of [
      ["window", { action: "plant" }],
      ["harvest-range", { anchor: "sowing" }],
      ["soil-temperature", { interpretation: "germination" }],
      ["context", { heating: "heated" }],
      ["modifier", { application: "applied" }],
    ] as const) {
      const candidate = ofKind(result.cultivation, kind)[0]!;
      expect(
        validate(
          "urn:hortinis:plants:schema:v1:cropgraph-cultivation-candidate",
          { ...candidate, value: { ...candidate.value, ...changes } },
        ).valid,
      ).toBe(false);
    }
  });
});
