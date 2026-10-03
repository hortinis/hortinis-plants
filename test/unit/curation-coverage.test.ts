import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createIntegratedFixture,
  writeJson,
  authorReviewedIdentity,
} from "../support/integrated-curation-fixture.js";
import { buildCurationCoverage } from "../../src/curation/curation-coverage.js";
import { getCurationStatus } from "../../src/curation/curation-inspection.js";
import { validateCurationDataset } from "../../src/curation/curation-validation.js";
import { readIntegratedReviewDraft } from "../../src/curation/integrated-review-reader.js";
import {
  object,
  records,
  field,
} from "../../src/curation/curation-artifacts.js";
import type { ValidationDataset } from "../../src/curation/validation-dataset.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const value = await createIntegratedFixture();
  roots.push(value.root);
  const validation = await validateCurationDataset(value.options);
  const draft = await readIntegratedReviewDraft({
    directory: value.drafts,
    validationApi: value.options.validationApi,
  });
  const dimensions = {
    structural: validation.structural,
    sourceAudit: { status: "validated" as const, valid: true, issues: [] },
    draftIntegrity: { status: "validated" as const, valid: true, issues: [] },
  };
  return {
    ...value,
    datasetValue: validation.loaded!.dataset,
    draft,
    dimensions,
  };
}

describe("C4 coverage and delivery accounting", () => {
  it("reports unspecified actions for primitive and array-valued cultivation candidates", async () => {
    const value = await fixture();
    const packet = value.draft.packets.find(
      (row) => row.sourceKind === "grow",
    )!;
    const original = records(packet.cultivationCandidates)[0]!;
    const candidates = ["sunny", 7, ["loam"], null].map(
      (normalizedValue, index) => ({
        ...original,
        id: `primitive-${index}`,
        normalizedValue,
        value: normalizedValue,
      }),
    );
    const report = await buildCurationCoverage(
      value.options,
      value.datasetValue,
      {
        ...value.draft,
        packets: value.draft.packets.map((row) =>
          row.id === packet.id
            ? { ...row, cultivationCandidates: candidates }
            : row,
        ),
      },
      value.dimensions,
    );
    expect(report.cohorts.grow.actions.unspecified).toMatchObject({
      total: 4,
      pending: 4,
    });
  });
  it.each(["prefer-assertion", "retain-both"])(
    "accounts for an explicit %s comparison without choosing a claim",
    async (decision) => {
      const value = await fixture();
      const comparison = value.draft.comparisons[0]!;
      const report = await buildCurationCoverage(
        value.options,
        {
          ...value.datasetValue,
          reviews: [
            { id: "comparison-review", purpose: "content", status: "accepted" },
          ],
          assertionComparisonDecisions: [
            {
              id: "comparison-decision",
              reviewId: "comparison-review",
              comparisonId: comparison.id,
              draftManifestSha256: value.draft.manifestSha256,
              decision,
            },
          ],
        },
        value.draft,
        value.dimensions,
      );
      expect(report.comparisons).toMatchObject({
        total: 1,
        accepted: 1,
        deferred: 0,
        pending: 0,
      });
      expect(
        report.cohorts.grow.candidates.cultivationCandidates!.accepted,
      ).toBe(0);
    },
  );
  it("allows only explicitly reviewed limitations to account for unresolved identity and deferrals", async () => {
    const value = await fixture();
    const packet = value.draft.packets.find(
      (row) => row.sourceKind === "grow",
    )!;
    const candidate = records(packet.cultivationCandidates)[0]!;
    const review = {
      id: "review-limitation",
      purpose: "content",
      status: "accepted",
    };
    const name = {
      id: "unresolved-name",
      reviewId: review.id,
      sourceRecordKey: packet.sourceRecordKey,
      decision: "unresolved",
    };
    const assertion = {
      id: "deferred-assertion",
      reviewId: review.id,
      sourceCandidateId: candidate.id,
      decision: "defer",
      draftManifestSha256: value.draft.manifestSha256,
    };
    const issue = {
      id: "limitation",
      status: "accepted-limitation",
      resolution: "Preserve unresolved identity and dynamic timing",
      affectedRecordIds: [name.id, assertion.id],
    };
    const dataset = {
      ...value.datasetValue,
      reviews: [review],
      sourceNameDecisions: [name],
      sourceAssertionDecisions: [assertion],
      curationIssues: [issue],
      packetDecisions: [
        {
          id: "issue-decision",
          reviewId: review.id,
          kind: "issue",
          disposition: "accept",
          draftManifestSha256: value.draft.manifestSha256,
          records: [{ id: issue.id, value: issue }],
        },
      ],
    };
    const report = await buildCurationCoverage(
      value.options,
      dataset,
      value.draft,
      value.dimensions,
    );
    expect(report.acceptedLimitations).toEqual([issue.id]);
    expect(report.cohorts.grow.identity).toMatchObject({
      accepted: 0,
      deferred: 1,
      pending: 1,
    });
    expect(report.uncoveredDeferrals).toEqual([]);
    const unreviewed = await buildCurationCoverage(
      value.options,
      { ...dataset, packetDecisions: [] },
      value.draft,
      value.dimensions,
    );
    expect(unreviewed.acceptedLimitations).toEqual([]);
    expect(unreviewed.cohorts.grow.identity.pending).toBe(2);
    expect(unreviewed.uncoveredDeferrals).toEqual([assertion.id]);
  });
  it("validates aggregate readiness with complete pinned accounting and permits missing translations", async () => {
    const value = await fixture();
    const targetFile = object(
      JSON.parse(await readFile("data/curation/delivery-targets.json", "utf8")),
    );
    const targets = records(targetFile.targets).map((row, index) => ({
      ...row,
      kind: field(row, "kind"),
      subjectId: `subject-${index}`,
      reviewId: "content",
    }));
    const path = join(value.root, "bound-targets.json");
    await writeJson(path, { ...targetFile, targets });
    const packets = Array.from({ length: 5146 }, (_, index) => ({
      id: `packet-${index}`,
      sourceKind: index < 140 ? "grow" : "cropgraph",
      sourceRecordKey: {
        source: index < 140 ? value.growKey.source : value.cropKey.source,
        recordId: `record-${index}`,
      },
      identityCandidates: [],
      taxonomyOutcomes: [],
      cultivationCandidates: [] as Record<string, unknown>[],
      localizationProposals: [],
    }));
    const reviews = [
      { id: "content", purpose: "content", status: "accepted" },
      { id: "rights", purpose: "rights", status: "accepted" },
    ];
    const names = packets.map((packet, index) => ({
      id: `name-${index}`,
      sourceRecordKey: packet.sourceRecordKey,
      reviewId: "content",
      decision: index < 35 ? "accept-candidate" : "reject",
      externalTaxonomyCrosswalkId: `crosswalk-${index}`,
    }));
    const mappings = packets.map((packet, index) => ({
      id: `mapping-${index}`,
      sourceRecordKey: packet.sourceRecordKey,
      reviewId: "content",
      decision: index < 35 ? "map" : "reject",
      subject:
        index < 35
          ? { type: targets[index]!.kind, id: targets[index]!.subjectId }
          : undefined,
    }));
    const facts = targets
      .filter((row) => row.kind === "plant-concept")
      .flatMap((target) =>
        ["frost_sensitivity", "sowing_window"].map((predicate) => ({
          id: `${target.subjectId}-${predicate}`,
          subject: { type: target.kind, id: target.subjectId },
          predicate,
          evidenceReferenceIds: ["evidence"],
          contextId: "context",
          reviewId: "content",
        })),
      );
    const sourceDecisions = facts.map((fact, index) => {
      const packet = packets[Math.floor(index / 2)]!;
      const candidate = {
        id: `candidate-${fact.id}`,
        sourceRecordKey: packet.sourceRecordKey,
      };
      packet.cultivationCandidates.push(candidate);
      return {
        id: `decision-${fact.id}`,
        reviewId: "content",
        decision: "accept",
        sourceCandidateId: candidate.id,
        assertionId: fact.id,
        draftManifestSha256: value.draft.manifestSha256,
      };
    });
    const dataset = {
      ...value.datasetValue,
      reviews,
      sourceNameDecisions: names,
      sourceAssertionDecisions: sourceDecisions,
      contexts: [
        {
          id: "context",
          geographicScope: {
            type: "specified",
            geographicContextIds: ["france"],
          },
          growingSystem: "outdoor",
        },
      ],
      sourceSubjectMappings: mappings,
      assertions: facts,
      plantConcepts: targets
        .filter((row) => row.kind === "plant-concept")
        .map((row) => ({
          id: row.subjectId,
          status: "active",
          taxonId: `taxon-${row.subjectId}`,
        })),
      cultivars: targets
        .filter((row) => row.kind === "cultivar")
        .map((row) => ({
          id: row.subjectId,
          status: "active",
          plantConceptId: "subject-0",
        })),
      externalTaxonomyCrosswalks: targets.map((_, index) => ({
        id: `crosswalk-${index}`,
        taxonId: index < 33 ? `taxon-subject-${index}` : "taxon-subject-0",
        reviewId: "content",
        externalIdentifier: {
          sourceId: "source_world_flora_online_plant_list",
        },
      })),
      evidence: [
        {
          id: "evidence",
          rights: {
            decision: "eligible",
            reviewId: "rights",
            licenceId: "commercial",
          },
        },
      ],
      licences: [{ id: "commercial", commercialUse: "allowed" }],
    };
    const report = await buildCurationCoverage(
      { ...value.options, targetsPath: path },
      dataset,
      { ...value.draft, packets, comparisons: [] },
      value.dimensions,
    );
    expect(report.readiness).toMatchObject({
      status: "validated",
      ready: true,
      reasons: [],
    });
    expect(
      report.delivery.targets.every(
        (row) => !row.frenchPreferredName && !row.englishPreferredName,
      ),
    ).toBe(true);
    const missingFact = await buildCurationCoverage(
      { ...value.options, targetsPath: path },
      { ...dataset, assertions: facts.slice(1) },
      { ...value.draft, packets, comparisons: [] },
      value.dimensions,
    );
    expect(missingFact.readiness.ready).toBe(false);
    expect(missingFact.readiness.reasons).toContain(
      "MVP cold sensitivity or planting coverage lacks facts or reviewed limitations",
    );
  });
  it("keeps four denominators distinct and does not manufacture targets from source names", async () => {
    const value = await fixture();
    const report = await buildCurationCoverage(
      value.options,
      value.datasetValue,
      value.draft,
      value.dimensions,
    );
    expect(report.cohorts.grow.records).toBe(2);
    expect(report.cohorts.cropgraph.records).toBe(1);
    expect(
      report.cohorts.cropgraph.candidates.cultivationCandidates,
    ).toMatchObject({ total: 1, pending: 1, accepted: 0 });
    expect(report.delivery).toMatchObject({
      concepts: 33,
      cultivarExemplars: 2,
    });
    expect(report.delivery.targets.every((row) => row.subjectId === null)).toBe(
      true,
    );
    expect(report.readiness.ready).toBe(false);
    expect(report.comparisons).toMatchObject({ total: 1, pending: 1 });
  });

  it("retains null source denominators without drafts and still reports required delivery targets", async () => {
    const value = await fixture();
    await rm(value.drafts, { recursive: true });
    const status = await getCurationStatus(value.options);
    expect(status.coverage.available).toBe(false);
    expect(status.coverage.cohorts.grow.identity.total).toBeNull();
    expect(status.coverage.cohorts.cropgraph.records).toBeNull();
    expect(status.coverage.delivery.concepts).toBe(33);
    expect(status.coverage.readiness.status).toBe("in progress");
    expect(status.coverage.readiness.reasons).toContain("sourceAudit: planned");
  });

  it("does not count superseded or stale cultivation decisions, and distinguishes rejection and deferral", async () => {
    const value = await fixture();
    const candidate = records(
      value.draft.packets.find((row) => row.sourceKind === "cropgraph")!
        .cultivationCandidates,
    )[0]!;
    const review = {
      id: "review-coverage",
      purpose: "content",
      status: "accepted",
    };
    const old = {
      id: "decision-old",
      reviewId: review.id,
      sourceCandidateId: candidate.id,
      decision: "accept",
      draftManifestSha256: value.draft.manifestSha256,
    };
    const current = {
      ...old,
      id: "decision-current",
      supersedesDecisionId: old.id,
      decision: "defer",
    };
    const dataset = {
      ...value.datasetValue,
      reviews: [review],
      sourceAssertionDecisions: [old, current],
    };
    const report = await buildCurationCoverage(
      value.options,
      dataset,
      value.draft,
      value.dimensions,
    );
    expect(
      report.cohorts.cropgraph.candidates.cultivationCandidates,
    ).toMatchObject({ accepted: 0, deferred: 1, pending: 0 });
    const stale = await buildCurationCoverage(
      value.options,
      {
        ...dataset,
        sourceAssertionDecisions: [
          { ...current, draftManifestSha256: "0".repeat(64) },
        ],
      },
      value.draft,
      value.dimensions,
    );
    expect(
      stale.cohorts.cropgraph.candidates.cultivationCandidates,
    ).toMatchObject({ deferred: 0, pending: 1 });
    const rejected = await buildCurationCoverage(
      value.options,
      {
        ...dataset,
        sourceAssertionDecisions: [{ ...current, decision: "reject" }],
      },
      value.draft,
      value.dimensions,
    );
    expect(
      rejected.cohorts.cropgraph.candidates.cultivationCandidates,
    ).toMatchObject({ accepted: 0, rejected: 1 });
  });

  it("requires accepted rights reviews and commercial permission for every evidence reference", async () => {
    const value = await fixture();
    const packet = value.draft.packets.find(
      (row) => row.sourceKind === "cropgraph",
    )!;
    const candidate = records(packet.cultivationCandidates)[0]!;
    const content = { id: "content", purpose: "content", status: "accepted" };
    const rights = { id: "rights", purpose: "rights", status: "accepted" };
    const assertion = {
      id: "assertion",
      reviewId: content.id,
      evidenceReferenceIds: ["evidence"],
      contextId: "context",
      subject: { type: "cultivar", id: "cultivar" },
      predicate: "frost_sensitivity",
    };
    const dataset: ValidationDataset = {
      ...value.datasetValue,
      reviews: [content, rights],
      assertions: [assertion],
      contexts: [
        {
          id: "context",
          geographicScope: { type: "unknown" },
          growingSystem: "unknown",
        },
      ],
      sourceAssertionDecisions: [
        {
          id: "decision",
          reviewId: content.id,
          sourceCandidateId: candidate.id,
          assertionId: assertion.id,
          decision: "accept",
          draftManifestSha256: value.draft.manifestSha256,
        },
      ],
      evidence: [
        {
          id: "evidence",
          rights: {
            licenceId: "licence",
            decision: "eligible",
            reviewId: rights.id,
          },
        },
      ],
      licences: [{ id: "licence", commercialUse: "forbidden" }],
    };
    const report = await buildCurationCoverage(
      value.options,
      dataset,
      value.draft,
      value.dimensions,
    );
    expect(report.cohorts.cropgraph.commercialRights).toMatchObject({
      total: 1,
      accepted: 0,
      pending: 1,
    });
    expect(report.cohorts.cropgraph.contexts.pending).toBe(1);
    const cleared = await buildCurationCoverage(
      value.options,
      { ...dataset, licences: [{ id: "licence", commercialUse: "allowed" }] },
      value.draft,
      value.dimensions,
    );
    expect(cleared.cohorts.cropgraph.commercialRights.accepted).toBe(1);
  });

  it("does not promote cultivar evidence into a generic concept or silently attach translations", async () => {
    const value = await fixture();
    const targets = join(value.root, "targets.json");
    const review = {
      id: "target-review",
      purpose: "content",
      status: "accepted",
    };
    await writeJson(targets, {
      schemaVersion: "1.0.0",
      policy: "c4-readiness-v1",
      targets: [
        {
          id: "target",
          kind: "plant-concept",
          label: "Tomato",
          subjectId: "tomato",
          reviewId: review.id,
        },
      ],
    });
    const candidate = records(
      value.draft.packets.find((row) => row.sourceKind === "cropgraph")!
        .cultivationCandidates,
    )[0]!;
    const dataset = {
      ...value.datasetValue,
      reviews: [review],
      sourceAssertionDecisions: [
        {
          id: "cultivar-decision",
          reviewId: review.id,
          decision: "accept",
          sourceCandidateId: candidate.id,
          assertionId: "cultivar-assertion",
          draftManifestSha256: value.draft.manifestSha256,
        },
      ],
      plantConcepts: [{ id: "tomato", status: "active" }],
      cultivars: [
        { id: "cultivar", status: "active", plantConceptId: "tomato" },
      ],
      assertions: [
        {
          id: "cultivar-assertion",
          evidenceReferenceIds: [],
          reviewId: review.id,
          subject: { type: "cultivar", id: "cultivar" },
          predicate: "frost_sensitivity",
        },
      ],
      localizedNames: [
        {
          id: "name",
          subject: { type: "plant-concept", id: "tomato" },
          preferred: true,
          languageTag: "fr",
          value: "Tomate",
        },
      ],
    };
    const report = await buildCurationCoverage(
      { ...value.options, targetsPath: targets },
      dataset,
      value.draft,
      value.dimensions,
    );
    expect(report.delivery.targets[0]).toMatchObject({
      subjectId: "tomato",
      coldSensitivity: false,
      cultivarOnlyEvidence: true,
      frenchPreferredName: false,
      identity: false,
    });
  });

  it("schema-validates targets and rejects duplicate opaque identifiers and duplicate subject bindings", async () => {
    const value = await fixture();
    const path = join(value.root, "targets.json");
    const file = object(
      JSON.parse(await readFile("data/curation/delivery-targets.json", "utf8")),
    );
    const first = records(file.targets)[0]!;
    await writeJson(path, { ...file, targets: [first, first] });
    await expect(
      buildCurationCoverage(
        { ...value.options, targetsPath: path },
        value.datasetValue,
        value.draft,
        value.dimensions,
      ),
    ).rejects.toThrow("Duplicate");
    await writeJson(path, {
      ...file,
      targets: [{ ...first, subjectId: "missing-review" }],
    });
    await expect(
      buildCurationCoverage(
        { ...value.options, targetsPath: path },
        value.datasetValue,
        value.draft,
        value.dimensions,
      ),
    ).rejects.toThrow("delivery-targets");
  });

  it("keeps absent TAXREF localization independent of reviewed WFO identity", async () => {
    const value = await fixture();
    await authorReviewedIdentity(value);
    const status = await getCurationStatus({ ...value.options, deep: true });
    expect(status.coverage.cohorts.grow.identity.accepted).toBe(1);
    expect(status.localization.notReconciled).toBe(1);
    expect(field(status.coverage.delivery.targets[0]!, "label")).toBe("tomato");
  });
});
