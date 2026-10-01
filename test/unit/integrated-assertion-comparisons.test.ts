import { describe, expect, it } from "vitest";
import {
  compareIntegratedPackets,
  type ComparisonPacket,
} from "../../src/curation/integrated-assertion-comparisons.js";
import {
  makeQualifiedSourceRecordKey,
  makeSemanticSubrecordKey,
  makeSourceReleaseKey,
} from "../../src/domain/source-keys.js";

const growSource = makeSourceReleaseKey("source_grow", "grow_manifest", "2020");
const cropSource = makeSourceReleaseKey(
  "source_cropgraph",
  "crop_manifest",
  "release",
);

function taxonomy(identifier: string) {
  return [
    {
      outcome: "candidate-accepted",
      alternatives: [{ externalIdentifier: { identifier } }],
    },
  ];
}

function packets(
  options: {
    growAction?: string;
    growTiming?: Record<string, unknown>;
    cropTiming?: Record<string, unknown>;
    growName?: string;
    cropName?: string;
    cropWfo?: string;
    cropCitation?: string;
    cropCountry?: string;
    cropSystem?: string;
  } = {},
): [ComparisonPacket, ComparisonPacket] {
  const growKey = makeQualifiedSourceRecordKey(growSource, "1");
  const cropKey = makeQualifiedSourceRecordKey(cropSource, "tomato");
  const growTiming = options.growTiming ?? {
    type: "relative-day-window",
    anchor: "last_spring_frost",
    startOffsetDays: -42,
    endOffsetDays: -14,
  };
  const cropTiming = options.cropTiming ?? growTiming;
  return [
    {
      id: "grow-packet",
      sourceKind: "grow",
      sourceRecordKey: growKey,
      sourceRecord: { fields: { "Common name": options.growName ?? "Tomato" } },
      taxonomyOutcomes: taxonomy("wfo-tomato"),
      cultivationCandidates: [
        {
          id: "grow-claim",
          sourceRecordKey: growKey,
          predicate: "calendar_window",
          rawValue: { source: "GROW" },
          normalizedValue: {
            ...growTiming,
            action: options.growAction ?? "direct_sow",
          },
          applicability: {
            geography: { country: options.cropCountry ?? "United States" },
            growingSystem: "outdoor",
          },
          sourceLocator: "grow-source-locator",
        },
      ],
    },
    {
      id: "crop-packet",
      sourceKind: "cropgraph",
      sourceRecordKey: cropKey,
      sourceRecord: { rawEntry: { commonName: options.cropName ?? "tomato" } },
      taxonomyOutcomes: taxonomy(options.cropWfo ?? "wfo-tomato"),
      cultivationCandidates: [
        {
          id: "crop-claim",
          kind: "window",
          sourceRecordKey: cropKey,
          sourceClaimKey: makeSemanticSubrecordKey(cropKey, [
            { kind: "field", id: "window" },
          ]),
          rawValue: { source: "CropGraph" },
          value: {
            action: "direct_sow",
            timing: cropTiming,
            geography: { country: "United States" },
          },
          effectiveCitation: options.cropCitation ?? "CropGraph source summary",
        },
        {
          id: "crop-context",
          kind: "context",
          value: { growingContext: options.cropSystem ?? "outdoor" },
        },
      ],
    },
  ];
}

describe("integrated assertion comparisons", () => {
  it("retains both source claims and is independent of packet order", () => {
    const input = packets();
    const forward = compareIntegratedPackets(input);
    const reversed = compareIntegratedPackets([...input].reverse());
    expect(forward.comparisons).toEqual(reversed.comparisons);
    expect(forward.comparisons).toHaveLength(1);
    expect(forward.comparisons[0]?.outcome).toBe("agreement");
    expect(
      forward.comparisons[0]?.candidates.map((item) => item.sourceClaim),
    ).toContainEqual(input[0].cultivationCandidates[0]);
    expect(
      forward.comparisons[0]?.candidates.map((item) => item.sourceClaim),
    ).toContainEqual(input[1].cultivationCandidates[0]);
    expect(forward.idsByPacket.get("grow-packet")).toEqual(
      forward.idsByPacket.get("crop-packet"),
    );
  });

  it("marks a comparable value disagreement as conflict without choosing a source", () => {
    const [grow, crop] = packets({
      cropTiming: {
        type: "relative-day-window",
        anchor: "last_spring_frost",
        startOffsetDays: -35,
        endOffsetDays: -14,
      },
    });
    const comparison = compareIntegratedPackets([grow, crop]).comparisons[0];
    expect(comparison?.outcome).toBe("conflict");
    expect(comparison?.dimensions.timing).toBe("different");
    expect(comparison).not.toHaveProperty("preferredAssertion");
  });

  it("keeps calendar and frost timing, and ambiguous GROW action, non-comparable", () => {
    const [grow, crop] = packets({
      growAction: "outdoor_sowing_or_planting",
      growTiming: {
        type: "calendar-date-window",
        start: { month: 3, day: 1 },
        end: { month: 4, day: 1 },
      },
    });
    const comparison = compareIntegratedPackets([grow, crop]).comparisons[0];
    expect(comparison?.outcome).toBe("not-comparable");
    expect(comparison?.dimensions.action).toBe("unresolved");
    expect(comparison?.dimensions.timing).toBe("unresolved");
  });

  it("does not match a different common name or WFO identity", () => {
    expect(
      compareIntegratedPackets(packets({ cropName: "Cherry tomato" }))
        .comparisons,
    ).toHaveLength(0);
    expect(
      compareIntegratedPackets(packets({ cropWfo: "wfo-other" })).comparisons,
    ).toHaveLength(0);
  });

  it("does not propose a subject link from ambiguous WFO alternatives", () => {
    const [grow, crop] = packets();
    const ambiguous = {
      ...grow,
      taxonomyOutcomes: [
        {
          outcome: "candidate-accepted",
          alternatives: [
            { externalIdentifier: { identifier: "wfo-tomato" } },
            { externalIdentifier: { identifier: "wfo-other" } },
          ],
        },
      ],
    };
    expect(
      compareIntegratedPackets([ambiguous, crop]).comparisons,
    ).toHaveLength(0);
  });

  it("does not turn different geography or growing system into a conflict", () => {
    const geographic = compareIntegratedPackets(
      packets({ cropCountry: "Canada" }),
    ).comparisons[0];
    const system = compareIntegratedPackets(
      packets({ cropSystem: "greenhouse" }),
    ).comparisons[0];
    expect(geographic?.dimensions.geography).toBe("different");
    expect(geographic?.outcome).toBe("not-comparable");
    expect(system?.dimensions.growingSystem).toBe("different");
    expect(system?.outcome).toBe("not-comparable");
  });

  it("flags a possible shared upstream citation without claiming independence", () => {
    const comparison = compareIntegratedPackets(
      packets({ cropCitation: "University of Dundee GROW data" }),
    ).comparisons[0];
    expect(comparison?.sharedUpstreamEvidence.status).toBe("possible");
    expect(comparison?.matchEvidence.subjectReviewState).toBe("unreviewed");
  });
});
