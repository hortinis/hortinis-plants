import { createHash } from "node:crypto";
import { serializeCanonicalJson } from "../serialization/canonical-json.js";
import { type SemanticSubrecordKey } from "./source-keys.js";

export type AssertionComparisonOutcome =
  "agreement" | "conflict" | "not-comparable";

export interface AssertionCandidateReference {
  readonly candidateId: string;
  readonly sourceClaimKey: SemanticSubrecordKey;
}

export interface AssertionComparisonCandidate extends AssertionCandidateReference {
  readonly sourceClaim: Readonly<Record<string, unknown>>;
}

export interface AssertionComparison {
  readonly id: string;
  readonly reviewState: "unreviewed";
  readonly outcome: AssertionComparisonOutcome;
  readonly candidates: readonly [
    AssertionComparisonCandidate,
    AssertionComparisonCandidate,
  ];
  readonly reason: string;
}

export interface AssertionComparisonInput {
  readonly outcome: AssertionComparisonOutcome;
  readonly candidates: readonly [
    AssertionComparisonCandidate,
    AssertionComparisonCandidate,
  ];
  readonly reason: string;
}

/**
 * Create a comparison whose candidate ordering and identity do not depend on
 * which source was supplied first. The claim snapshots are retained verbatim.
 */
export function createAssertionComparison(
  input: AssertionComparisonInput,
): AssertionComparison {
  const candidates = sortCandidates(input.candidates);
  const candidateKeys = candidates.map(candidateKey);
  const sourceClaimKeys = candidates.map((candidate) =>
    sourceClaimKey(candidate.sourceClaimKey),
  );
  if (
    new Set(candidateKeys).size !== candidates.length ||
    new Set(sourceClaimKeys).size !== candidates.length
  ) {
    throw new Error("An assertion comparison requires two distinct candidates");
  }
  const idDigest = createHash("sha256")
    .update(
      serializeCanonicalJson({
        candidates: candidateKeys,
        outcome: input.outcome,
      }),
    )
    .digest("hex")
    .slice(0, 32);
  return {
    id: `assertion-comparison-${idDigest}`,
    reviewState: "unreviewed",
    outcome: input.outcome,
    candidates,
    reason: input.reason,
  };
}

export function sortCandidates(
  candidates: readonly [
    AssertionComparisonCandidate,
    AssertionComparisonCandidate,
  ],
): readonly [AssertionComparisonCandidate, AssertionComparisonCandidate] {
  const sorted = [...candidates].sort((left, right) =>
    candidateKey(left).localeCompare(candidateKey(right)),
  );
  return [sorted[0]!, sorted[1]!];
}

export function candidateKey(candidate: AssertionCandidateReference): string {
  return new TextDecoder().decode(
    serializeCanonicalJson({
      candidateId: candidate.candidateId,
      sourceClaimKey: candidate.sourceClaimKey,
    }),
  );
}

function sourceClaimKey(key: SemanticSubrecordKey): string {
  return new TextDecoder().decode(serializeCanonicalJson(key));
}

export function isPreferredAssertionInComparison(
  comparison: AssertionComparison,
  preferred: AssertionCandidateReference,
): boolean {
  return comparison.candidates.some(
    (candidate) => candidateKey(candidate) === candidateKey(preferred),
  );
}
