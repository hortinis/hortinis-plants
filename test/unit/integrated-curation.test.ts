import { mkdir, readFile, rm, writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  authorReviewedIdentity,
  createIntegratedFixture,
  fixtureRecord,
  writeJson,
} from "../support/integrated-curation-fixture.js";
import {
  getCurationStatus,
  showCurationRecord,
} from "../../src/curation/curation-inspection.js";
import {
  auditCurationDecisionLineage,
  validateCurationDataset,
} from "../../src/curation/curation-validation.js";
import { generateIntegratedReviewPackets } from "../../src/curation/integrated-review-packets.js";
import {
  contentDigest,
  digest,
} from "../../src/curation/curation-artifacts.js";

const roots: string[] = [];
async function fixture() {
  const value = await createIntegratedFixture();
  roots.push(value.root);
  return value;
}
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

describe("integrated read-only curation", () => {
  it("validates structure without any ignored inputs and reports unavailable coverage honestly", async () => {
    const value = await fixture();
    await rm(value.drafts, { recursive: true });
    await rm(value.grow, { recursive: true });
    const validation = await validateCurationDataset(value.options);
    expect(validation.structural.valid).toBe(true);
    expect(validation.sourceAudit).toMatchObject({
      status: "planned",
      valid: null,
    });
    const status = await getCurationStatus(value.options);
    expect(status.valid).toBe(true);
    expect(status.editorial.identity).toMatchObject({
      available: false,
      total: null,
    });
    expect(status.localization.available).toBe(false);
    expect(
      (await validateCurationDataset({ ...value.options, deep: true }))
        .sourceAudit.valid,
    ).toBe(false);
  });

  it("audits all four sources and keeps missing localization separate from WFO outcomes", async () => {
    const value = await fixture();
    const validation = await validateCurationDataset({
      ...value.options,
      deep: true,
    });
    expect(validation.sourceAudit.issues).toEqual([]);
    expect(validation.valid).toBe(true);
    const status = await getCurationStatus(value.options);
    expect(status.editorial.identity).toMatchObject({
      available: true,
      total: 3,
      pending: 3,
    });
    expect(status.editorial.comparison.total).toBe(1);
    expect(status.localization).toMatchObject({
      eligibleIdentities: 0,
      notYetEligibleRecords: 3,
      notReconciled: 0,
      proposalCount: 0,
    });
    expect(status.sourceAudit.valid).toBeNull();
  });

  it("rejects colliding local IDs and selects the exact source and release", async () => {
    const value = await fixture();
    await expect(
      showCurationRecord({ recordId: "1" }, value.options),
    ).rejects.toThrow("ambiguous");
    const grow = await showCurationRecord(
      { sourceRecordKey: value.growKey },
      value.options,
    );
    const crop = await showCurationRecord(
      { sourceRecordKey: value.cropKey },
      value.options,
    );
    expect(grow.packet.sourceKind).toBe("grow");
    expect(crop.packet.sourceKind).toBe("cropgraph");
    expect(grow.comparisons).toEqual(crop.comparisons);
    expect(grow.comparisons).toHaveLength(1);
    await expect(
      showCurationRecord(
        { recordId: "1", sourceReleaseId: "wrong" },
        value.options,
      ),
    ).rejects.toThrow("not found");
    expect(
      (
        await showCurationRecord(
          { packetId: String(grow.packet.id) },
          value.options,
        )
      ).packet,
    ).toEqual(grow.packet);
  });

  it("uses current reviewed identity decisions and keeps absent TAXREF coverage out of that gate", async () => {
    const value = await fixture();
    await authorReviewedIdentity(value);
    const status = await getCurationStatus({ ...value.options, deep: true });
    expect(status.structural.issues).toEqual([]);
    expect(status.sourceAudit.issues).toEqual([]);
    expect(status.editorial.identity).toMatchObject({
      total: 3,
      accounted: 1,
      pending: 2,
    });
    expect(status.localization).toMatchObject({
      eligibleIdentities: 1,
      notYetEligibleRecords: 2,
      notReconciled: 1,
    });
    const view = await showCurationRecord(
      { sourceRecordKey: value.growKey },
      value.options,
    );
    expect(view.decisions.name).toHaveLength(2);
    expect(view.authored.crosswalks).toHaveLength(1);
    expect(view.authored.reviews).toHaveLength(2);
  });

  it("reports a TAXREF not-found outcome without undoing reviewed WFO identity", async () => {
    const value = await fixture();
    const crosswalk = await authorReviewedIdentity(value);
    const outcome = await fixtureRecord("taxref-wfo-link-outcome-valid.json");
    Object.assign(outcome, {
      taxonId: crosswalk.taxonId,
      wfoCrosswalkId: crosswalk.id,
      wfoExternalIdentifier: crosswalk.externalIdentifier,
      wfoIdentifier: "wfo-0000000010",
      outcome: "not-found",
      candidateTaxrefIdentifiers: [],
      evidence: [],
    });
    const bytes = Buffer.from(JSON.stringify(outcome) + "\n");
    await writeFile(join(value.taxref, "link-outcomes.jsonl"), bytes);
    const path = join(value.taxref, "reconciliation-run-manifest.json");
    const manifest = JSON.parse(await readFile(path, "utf8")) as {
      outputs: Record<string, unknown>[];
    };
    Object.assign(
      manifest.outputs.find((row) => row.path === "link-outcomes.jsonl")!,
      { sha256: digest(bytes), byteSize: bytes.byteLength, recordCount: 1 },
    );
    await writeJson(path, manifest);
    await generateIntegratedReviewPackets(value.generatorOptions);
    const status = await getCurationStatus({ ...value.options, deep: true });
    expect(status.sourceAudit.issues).toEqual([]);
    expect(status.editorial.identity.accounted).toBe(1);
    expect(status.localization.outcomes["not-found"]).toBe(1);
    expect(status.localization.notReconciled).toBe(0);
  });

  it("retains deferred assertions for inspection and rejects stale decision fingerprints", async () => {
    const value = await fixture();
    const view = await showCurationRecord(
      { sourceRecordKey: value.cropKey },
      value.options,
    );
    const candidate = (
      view.packet.cultivationCandidates as Record<string, unknown>[]
    )[0]!;
    const decision = await fixtureRecord(
      "authoring-source-assertion-decision-deferred-valid.json",
    );
    decision.sourceCandidateId = candidate.id;
    decision.draftManifestSha256 = "0".repeat(64);
    await writeFile(
      join(value.dataset, "source-assertion-decisions.jsonl"),
      JSON.stringify(decision) + "\n",
    );
    await writeFile(
      join(value.dataset, "reviews.jsonl"),
      JSON.stringify({
        id: "review-assertion-1",
        purpose: "content",
        status: "accepted",
        reviewedAt: "2026-10-02T00:00:00Z",
        reviewerId: "reviewer-fixture",
      }) + "\n",
    );
    await generateIntegratedReviewPackets(value.generatorOptions);
    const shown = await showCurationRecord(
      { sourceRecordKey: value.cropKey },
      value.options,
    );
    expect(shown.decisions.assertion).toHaveLength(1);
    expect(
      (shown.packet.authoredDecisions as Record<string, unknown>)
        .sourceAssertionDecisions,
    ).toHaveLength(1);
    expect(
      (await getCurationStatus(value.options)).editorial.assertion.accounted,
    ).toBe(0);
    const validation = await validateCurationDataset({
      ...value.options,
      deep: true,
    });
    expect(validation.structural.valid).toBe(true);
    expect(validation.sourceAudit.issues[0]?.message).toContain(
      "Assertion decision lineage differs",
    );
  });

  it.each(["grow", "crop", "wfo", "taxref"] as const)(
    "detects stale %s runs without invalidating tracked structure",
    async (kind) => {
      const value = await fixture();
      const filename =
        kind === "grow" || kind === "crop"
          ? "importer-run-manifest.json"
          : "reconciliation-run-manifest.json";
      await writeFile(join(value[kind], filename), "{}\n");
      const result = await validateCurationDataset({
        ...value.options,
        deep: true,
      });
      expect(result.structural.valid).toBe(true);
      expect(result.sourceAudit.valid).toBe(false);
      expect(
        (await getCurationStatus({ ...value.options, deep: true })).editorial
          .identity.available,
      ).toBe(false);
    },
  );

  it.each([
    "review-scope.json",
    "integrated-review-queue.jsonl",
    "integrated-review-packets.jsonl",
    "assertion-comparisons.jsonl",
  ])("detects changed %s", async (filename) => {
    const value = await fixture();
    await writeFile(join(value.drafts, filename), "{}\n");
    const status = await getCurationStatus(value.options);
    expect(status.structural.valid).toBe(true);
    expect(status.draftIntegrity.valid).toBe(false);
    expect(status.editorial.identity.available).toBe(false);
  });

  it("detects cohort drift and an explicitly mismatched frozen scope", async () => {
    const value = await fixture();
    await writeJson(value.cohort, { include: ["different"] });
    expect(
      (await validateCurationDataset({ ...value.options, deep: true }))
        .sourceAudit.valid,
    ).toBe(false);
    const scopePath = join(value.root, "wrong-scope.json");
    await writeJson(scopePath, {});
    expect(
      (await getCurationStatus({ ...value.options, scopePath })).draftIntegrity
        .valid,
    ).toBe(false);
  });

  it("rejects symlink escape even when artifact bytes match", async () => {
    const value = await fixture();
    const packetPath = join(value.drafts, "integrated-review-packets.jsonl");
    const outside = join(value.root, "outside.jsonl");
    await writeFile(outside, await readFile(packetPath));
    await rm(packetPath);
    await symlink(outside, packetPath);
    const status = await getCurationStatus(value.options);
    expect(status.draftIntegrity.issues[0]?.message).toContain("escapes");
  });

  it("generates deterministic artifacts and preserves the previous draft on scope failure", async () => {
    const value = await fixture();
    const before = await readFile(join(value.drafts, "draft-manifest.json"));
    const second = join(value.root, "second");
    await generateIntegratedReviewPackets({
      ...value.generatorOptions,
      outputDirectory: second,
      scopePath: join(value.drafts, "review-scope.json"),
    });
    for (const filename of [
      "draft-manifest.json",
      "review-scope.json",
      "integrated-review-packets.jsonl",
      "integrated-review-queue.jsonl",
      "assertion-comparisons.jsonl",
    ]) {
      expect(await readFile(join(second, filename))).toEqual(
        await readFile(join(value.drafts, filename)),
      );
    }
    const scope = join(value.root, "wrong-scope.json");
    await writeJson(scope, {});
    await expect(
      generateIntegratedReviewPackets({
        ...value.generatorOptions,
        scopePath: scope,
      }),
    ).rejects.toThrow("scope differs");
    expect(await readFile(join(value.drafts, "draft-manifest.json"))).toEqual(
      before,
    );
  });

  it("refuses output paths that could replace authored data or input runs", async () => {
    const value = await fixture();
    const before = await readFile(join(value.dataset, "dataset-manifest.json"));
    await expect(
      generateIntegratedReviewPackets({
        ...value.generatorOptions,
        outputDirectory: value.dataset,
      }),
    ).rejects.toThrow("overlaps protected");
    await expect(
      generateIntegratedReviewPackets({
        ...value.generatorOptions,
        outputDirectory: value.grow,
      }),
    ).rejects.toThrow("overlaps protected");
    const alias = join(value.root, "dataset-alias");
    await symlink(value.dataset, alias);
    await expect(
      generateIntegratedReviewPackets({
        ...value.generatorOptions,
        outputDirectory: join(alias, "generated"),
      }),
    ).rejects.toThrow("overlaps protected");
    expect(
      await readFile(join(value.dataset, "dataset-manifest.json")),
    ).toEqual(before);
  });

  it("audits pinned local importer resources independently of staged output bytes", async () => {
    const value = await fixture();
    await writeFile(
      join(value.options.sourceDirectories.grow, "input.txt"),
      "Changed resource\n",
    );
    const result = await validateCurationDataset({
      ...value.options,
      deep: true,
    });
    expect(result.structural.valid).toBe(true);
    expect(result.sourceAudit.issues[0]?.message).toContain(
      "Checksum or byte size",
    );
  });

  it("validates transitive run schemas even when the run was already audited", async () => {
    const value = await fixture();
    const bytes = await readFile(
      join(value.grow, "importer-run-manifest.json"),
    );
    const path = join(value.wfo, "reconciliation-run-manifest.json");
    const manifest = JSON.parse(await readFile(path, "utf8")) as {
      inputs: Record<string, unknown>[];
    };
    manifest.inputs.push({
      role: "grow-importer-run-manifest",
      locator: "grow-import-run:importer-run-manifest.json",
      sha256: digest(bytes),
      byteSize: bytes.byteLength,
      schemaId:
        "urn:hortinis:plants:schema:v1:taxonomy-reconciliation-manifest",
    });
    await writeJson(path, manifest);
    await generateIntegratedReviewPackets(value.generatorOptions);
    const result = await validateCurationDataset({
      ...value.options,
      deep: true,
    });
    expect(result.sourceAudit.issues[0]?.message).toContain("wrong schema");
  });

  it("supports a relocated TAXREF archive resource directory", async () => {
    const value = await fixture();
    const directory = join(value.root, "taxref-resources");
    await mkdir(directory);
    const bytes = Buffer.from("Fixture archive bytes");
    await writeFile(join(directory, "TAXREF_v18_2025.zip"), bytes);
    const path = join(value.taxref, "reconciliation-run-manifest.json");
    const manifest = JSON.parse(await readFile(path, "utf8")) as {
      inputs: Record<string, unknown>[];
    };
    manifest.inputs.push({
      role: "taxref-archive",
      locator: ".cache/source-inputs/taxref/18.0/TAXREF_v18_2025.zip",
      sha256: digest(bytes),
      byteSize: bytes.byteLength,
    });
    await writeJson(path, manifest);
    await generateIntegratedReviewPackets(value.generatorOptions);
    const result = await validateCurationDataset({
      ...value.options,
      sourceDirectories: {
        ...value.options.sourceDirectories,
        taxref: directory,
      },
      deep: true,
    });
    expect(result.sourceAudit.issues).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("validates prospective deferrals and checks exact comparison preference membership", async () => {
    const value = await fixture();
    const validation = await validateCurationDataset({
      ...value.options,
      deep: true,
    });
    const draft = validation.draft!;
    const dataset = validation.loaded!.dataset;
    const comparison = draft.comparisons[0]!;
    const candidates = comparison.candidates as Record<string, unknown>[];
    const reference = candidates[0]!;
    const decision = {
      id: "decision-comparison",
      comparisonId: comparison.id,
      draftManifestSha256: draft.manifestSha256,
      decision: "prefer-assertion",
      reason: "Explicit fixture preference",
      reviewId: "review-fixture",
      preferredAssertion: {
        candidateId: reference.candidateId,
        sourceClaimKey: reference.sourceClaimKey,
      },
    };
    expect(() =>
      auditCurationDecisionLineage(
        { ...dataset, assertionComparisonDecisions: [decision] },
        draft,
      ),
    ).not.toThrow();
    expect(() =>
      auditCurationDecisionLineage(
        {
          ...dataset,
          assertionComparisonDecisions: [
            {
              ...decision,
              preferredAssertion: {
                ...decision.preferredAssertion,
                candidateId: "wrong-candidate",
              },
            },
          ],
        },
        draft,
      ),
    ).toThrow("outside comparison");
    const cropPacket = draft.packets.find(
      (packet) => packet.sourceKind === "cropgraph",
    )!;
    const candidate = (
      cropPacket.cultivationCandidates as Record<string, unknown>[]
    )[0]!;
    const deferred = await fixtureRecord(
      "authoring-source-assertion-decision-deferred-valid.json",
    );
    deferred.sourceCandidateId = candidate.id;
    deferred.draftManifestSha256 = draft.manifestSha256;
    expect(() =>
      auditCurationDecisionLineage(
        { ...dataset, sourceAssertionDecisions: [deferred] },
        draft,
      ),
    ).not.toThrow();
  });

  it("checks membership even after a forged queue checksum is updated", async () => {
    const value = await fixture();
    const path = join(value.drafts, "integrated-review-queue.jsonl");
    const rows = (await readFile(path, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    rows[0]!.packetId = "missing-packet";
    const bytes = Buffer.from(
      rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
    );
    await writeFile(path, bytes);
    const manifestPath = join(value.drafts, "draft-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      queues: Record<string, unknown>[];
    };
    manifest.queues[0]!.sha256 = digest(bytes);
    manifest.queues[0]!.byteSize = bytes.byteLength;
    await writeJson(manifestPath, manifest);
    expect(
      (await getCurationStatus(value.options)).draftIntegrity.issues[0]
        ?.message,
    ).toContain("Queue membership differs");
  });

  it("checks frozen authored snapshots against the selected dataset, beyond packet hashes", async () => {
    const value = await fixture();
    const packetPath = join(value.drafts, "integrated-review-packets.jsonl");
    const packets = (await readFile(packetPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const packet = packets[0]!;
    packet.authoredDecisions = {
      sourceNameDecisions: [{ id: "invented-decision" }],
    };
    const content = { ...packet };
    delete content.contentSha256;
    packet.contentSha256 = contentDigest(content);
    const bytes = Buffer.from(
      packets.map((row) => JSON.stringify(row)).join("\n") + "\n",
    );
    await writeFile(packetPath, bytes);
    const manifestPath = join(value.drafts, "draft-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      packets: Record<string, unknown>[];
    };
    Object.assign(manifest.packets[0]!, {
      sha256: digest(bytes),
      byteSize: bytes.byteLength,
    });
    await writeJson(manifestPath, manifest);
    const result = await validateCurationDataset({
      ...value.options,
      deep: true,
    });
    expect(result.structural.valid).toBe(true);
    expect(result.sourceAudit.issues[0]?.message).toContain(
      "authored decision snapshot differs",
    );
  });
});
