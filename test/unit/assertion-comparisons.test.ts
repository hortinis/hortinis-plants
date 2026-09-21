import { describe, expect, it } from "vitest";
import {
  candidateKey,
  createAssertionComparison,
  isPreferredAssertionInComparison,
  type AssertionComparisonCandidate,
} from "../../src/domain/assertion-comparisons.js";
import {
  makeQualifiedSourceRecordKey,
  makeSemanticSubrecordKey,
  makeSourceReleaseKey,
} from "../../src/domain/source-keys.js";

const grow = makeSourceReleaseKey(
  "source_grow",
  "source_manifest_grow_2020",
  "2020",
);
const cropGraph = makeSourceReleaseKey(
  "source_cropgraph",
  "source_manifest_cropgraph",
  "e722c3415bcf2773277f3422e13a4de5efd29b48",
);

function candidate(
  source: typeof grow,
  recordId: string,
  candidateId: string,
  pathId: string,
): AssertionComparisonCandidate {
  return {
    candidateId,
    sourceClaimKey: makeSemanticSubrecordKey(
      makeQualifiedSourceRecordKey(source, recordId),
      [{ kind: "cultivation-window", id: pathId }],
    ),
    sourceClaim: {
      predicate: "sowing_window",
      value: pathId,
    },
  };
}

describe("assertion comparisons", () => {
  it("is independent of source input order", () => {
    const first = candidate(grow, "1", "candidate-grow", "sowing");
    const second = candidate(
      cropGraph,
      "1",
      "candidate-cropgraph",
      "direct-sow",
    );
    const forward = createAssertionComparison({
      outcome: "conflict",
      candidates: [first, second],
      reason: "The reviewed claims disagree.",
    });
    const reversed = createAssertionComparison({
      outcome: "conflict",
      candidates: [second, first],
      reason: "The reviewed claims disagree.",
    });

    expect(reversed).toEqual(forward);
    expect(forward.candidates[0]).toEqual(reversed.candidates[0]);
  });

  it("keeps equal local record IDs distinct by source release", () => {
    const first = candidate(grow, "1", "candidate-grow", "sowing");
    const second = candidate(cropGraph, "1", "candidate-cropgraph", "sowing");

    expect(candidateKey(first)).not.toBe(candidateKey(second));
    expect(
      createAssertionComparison({
        outcome: "agreement",
        candidates: [first, second],
        reason: "The source values agree.",
      }).candidates,
    ).toHaveLength(2);
  });

  it("accepts only a candidate actually present in the comparison", () => {
    const first = candidate(grow, "1", "candidate-grow", "sowing");
    const second = candidate(
      cropGraph,
      "1",
      "candidate-cropgraph",
      "direct-sow",
    );
    const comparison = createAssertionComparison({
      outcome: "not-comparable",
      candidates: [first, second],
      reason: "The timing anchors differ.",
    });

    expect(isPreferredAssertionInComparison(comparison, first)).toBe(true);
    expect(
      isPreferredAssertionInComparison(
        comparison,
        candidate(cropGraph, "2", "candidate-other", "direct-sow"),
      ),
    ).toBe(false);
  });

  it("rejects comparing a candidate with itself", () => {
    const first = candidate(grow, "1", "candidate-grow", "sowing");
    expect(() =>
      createAssertionComparison({
        outcome: "agreement",
        candidates: [first, first],
        reason: "Invalid self comparison.",
      }),
    ).toThrow("two distinct candidates");
  });

  it("rejects two candidate IDs for the same qualified source claim", () => {
    const first = candidate(grow, "1", "candidate-grow-a", "sowing");
    const second = candidate(grow, "1", "candidate-grow-b", "sowing");
    expect(() =>
      createAssertionComparison({
        outcome: "agreement",
        candidates: [first, second],
        reason: "Invalid duplicate source claim.",
      }),
    ).toThrow("two distinct candidates");
  });
});
