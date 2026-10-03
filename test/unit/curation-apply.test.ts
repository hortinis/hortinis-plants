import {
  readFile,
  readdir,
  rm,
  mkdir,
  writeFile,
  cp,
  symlink,
} from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createIntegratedFixture,
  writeJson,
  authorReviewedIdentity,
  fixtureRecord,
} from "../support/integrated-curation-fixture.js";
import {
  applyCurationDecision,
  type IntegratedDecisionInput,
  type IntegratedDecisionOperation,
} from "../../src/curation/curation-apply.js";
import { authoringFingerprint } from "../../src/curation/decision-transaction.js";
import { readIntegratedReviewDraft } from "../../src/curation/integrated-review-reader.js";
import {
  contentDigest,
  digest,
  object,
  records,
  field,
} from "../../src/curation/curation-artifacts.js";
import { generateIntegratedReviewPackets } from "../../src/curation/integrated-review-packets.js";
import { validateCurationDataset } from "../../src/curation/curation-validation.js";
import {
  getCurationStatus,
  showCurationRecord,
} from "../../src/curation/curation-inspection.js";
import { buildCurationCoverage } from "../../src/curation/curation-coverage.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const value = await createIntegratedFixture();
  roots.push(value.root);
  const manifest = object(
    JSON.parse(
      await readFile(join(value.dataset, "dataset-manifest.json"), "utf8"),
    ),
  );
  const dependencies = [...records(manifest.dependencies)];
  for (const kind of ["cropgraph", "taxref"])
    for (const [role, filename] of [
      ["source-manifest", "source-manifest.json"],
      ["source", "source.json"],
      ["licence", "licence.json"],
    ]) {
      const path = `data/sources/${kind}/${filename}`;
      const bytes = await readFile(path);
      const record = object(JSON.parse(bytes.toString()));
      if (!dependencies.some((row) => row.id === record.id))
        dependencies.push({
          role,
          id: record.id,
          path,
          format: "json",
          schemaId: `urn:hortinis:plants:schema:v1:${role}`,
          sha256: digest(bytes),
          authority: "tracked-source-metadata",
        });
    }
  const draft = await readIntegratedReviewDraft({
    directory: value.drafts,
    validationApi: value.options.validationApi,
  });
  const packet = draft.packets.find((row) => row.sourceKind === "grow")!;
  const review = {
    id: "review-apply",
    purpose: "content",
    status: "accepted",
    reviewedAt: "2026-10-02T00:00:00Z",
    reviewerId: "reviewer-fixture",
  };
  const source = {
    packetId: packet.id,
    packetSha256: packet.contentSha256,
    sourceRecordKey: packet.sourceRecordKey,
  };
  const operation: IntegratedDecisionOperation = {
    kind: "issue",
    source,
    mintAlias: "issue-operation",
    reviewId: review.id,
    disposition: "defer",
    reason: "Explicit unresolved issue",
    records: [
      { collection: "reviews", value: review },
      {
        collection: "curation-issues",
        value: {
          id: "issue-apply",
          kind: "unresolved-mapping",
          status: "open",
          affectedRecordIds: [packet.id],
          reason: "Explicit unresolved issue",
        },
      },
    ],
  };
  const input: IntegratedDecisionInput = {
    schemaVersion: "1.0.0",
    transactionId: "transaction-integrated",
    draftManifestSha256: draft.manifestSha256,
    baseDatasetSha256: await authoringFingerprint(
      value.dataset,
      records(manifest.collections).map((row) => ({
        path: field(row, "path"),
      })),
    ),
    datasetManifest: {
      ...manifest,
      dependencies,
      scope: "Explicit four-source fixture scope",
      reviewDraftCommand: "pnpm curate:drafts",
      collections: [
        ...records(manifest.collections),
        {
          role: "packet-decisions",
          path: "packet-decisions.jsonl",
          format: "jsonl",
          schemaId: "urn:hortinis:plants:schema:authoring:v1:packet-decision",
          authority: "curator-authored",
        },
      ],
    },
    operations: [operation],
  };
  return { ...value, manifest, draft, packet, input, operation, review };
}

async function rebase(value: Awaited<ReturnType<typeof fixture>>) {
  const manifest = object(
    JSON.parse(
      await readFile(join(value.dataset, "dataset-manifest.json"), "utf8"),
    ),
  );
  const draft = await readIntegratedReviewDraft({
    directory: value.drafts,
    validationApi: value.options.validationApi,
  });
  return {
    draft,
    input: {
      ...value.input,
      draftManifestSha256: draft.manifestSha256,
      baseDatasetSha256: await authoringFingerprint(
        value.dataset,
        records(manifest.collections).map((row) => ({
          path: field(row, "path"),
        })),
      ),
      datasetManifest: {
        ...value.input.datasetManifest,
        ...manifest,
        scope: value.input.datasetManifest!.scope,
        reviewDraftCommand: "pnpm curate:drafts",
        dependencies: value.input.datasetManifest!.dependencies,
        collections: value.input.datasetManifest!.collections,
      },
    },
  };
}
function source(
  packet: Record<string, unknown> | Readonly<Record<string, unknown>>,
  extra: Record<string, unknown> = {},
) {
  return {
    packetId: packet.id,
    packetSha256: packet.contentSha256,
    sourceRecordKey: packet.sourceRecordKey,
    ...extra,
  };
}
async function localizationFixture() {
  const value = await fixture();
  const crosswalk = await authorReviewedIdentity(value);
  const proposal = await fixtureRecord(
    "taxref-localization-proposal-valid.json",
  );
  Object.assign(proposal, {
    taxonId: crosswalk.taxonId,
    wfoCrosswalkId: crosswalk.id,
  });
  const outcome = await fixtureRecord("taxref-wfo-link-outcome-valid.json");
  Object.assign(outcome, {
    taxonId: crosswalk.taxonId,
    wfoCrosswalkId: crosswalk.id,
    wfoExternalIdentifier: crosswalk.externalIdentifier,
    wfoIdentifier: "wfo-0000000010",
    wfoReviewId: "review-taxonomy-1",
  });
  const path = join(value.taxref, "reconciliation-run-manifest.json");
  const run = object(JSON.parse(await readFile(path, "utf8")));
  for (const [filename, row] of [
    ["link-outcomes.jsonl", outcome],
    ["localization-proposals.jsonl", proposal],
  ] as const) {
    const bytes = Buffer.from(JSON.stringify(row) + "\n");
    await writeFile(join(value.taxref, filename), bytes);
    Object.assign(
      records(run.outputs).find((output) => output.path === filename)!,
      { sha256: digest(bytes), byteSize: bytes.length, recordCount: 1 },
    );
  }
  await writeJson(path, run);
  await generateIntegratedReviewPackets(value.generatorOptions);
  return { ...value, ...(await rebase(value)), crosswalk, proposal };
}

async function bytes(directory: string): Promise<Record<string, string>> {
  return Object.fromEntries(
    await Promise.all(
      (await readdir(directory))
        .sort()
        .map(async (path) => [
          path,
          (await readFile(join(directory, path))).toString("base64"),
        ]),
    ),
  ) as Record<string, string>;
}

describe("integrated transactional decision application", () => {
  it("accounts for an applied disposition after regenerated deep audit without repinning its approval", async () => {
    const value = await fixture();
    const candidate = records(value.packet.cultivationCandidates)[0]!;
    const decision = {
      id: "coverage-rejection",
      sourceCandidateId: candidate.id,
      draftManifestSha256: value.draft.manifestSha256,
      decision: "reject",
      reason: "Explicit reviewed exclusion",
      reviewId: value.review.id,
    };
    await applyCurationDecision(
      {
        ...value.input,
        operations: [
          {
            ...value.operation,
            kind: "assertion",
            disposition: "reject",
            source: source(value.packet, { candidateIds: [candidate.id] }),
            records: [
              { collection: "reviews", value: value.review },
              { collection: "source-assertion-decisions", value: decision },
            ],
          },
        ],
      },
      value.options,
    );
    expect(
      (await getCurationStatus({ ...value.options, deep: true })).coverage
        .available,
    ).toBe(false);
    await generateIntegratedReviewPackets(value.generatorOptions);
    const status = await getCurationStatus({ ...value.options, deep: true });
    expect(status.sourceAudit.issues).toEqual([]);
    expect(
      status.coverage.cohorts.grow.candidates.cultivationCandidates,
    ).toMatchObject({ total: 1, rejected: 1, pending: 0 });
    const noAudit = await getCurationStatus(value.options);
    expect(
      noAudit.coverage.cohorts.grow.candidates.cultivationCandidates!.pending,
    ).toBe(1);
    const validation = await validateCurationDataset({
      ...value.options,
      deep: true,
    });
    const draft = validation.draft!;
    const changed = {
      ...draft,
      packets: draft.packets.map((packet) =>
        packet.id !== value.packet.id
          ? packet
          : {
              ...packet,
              cultivationCandidates: records(packet.cultivationCandidates).map(
                (row) => ({ ...row, rawValue: "Changed claim" }),
              ),
            },
      ),
    };
    const report = await buildCurationCoverage(
      value.options,
      validation.loaded!.dataset,
      changed,
      {
        structural: validation.structural,
        sourceAudit: validation.sourceAudit,
        draftIntegrity: status.draftIntegrity,
      },
    );
    expect(report.cohorts.grow.candidates.cultivationCandidates).toMatchObject({
      rejected: 0,
      pending: 1,
    });
    const saved = JSON.parse(
      (
        await readFile(
          join(value.dataset, "source-assertion-decisions.jsonl"),
          "utf8",
        )
      ).trim(),
    ) as Record<string, unknown>;
    expect(saved.draftManifestSha256).toBe(value.draft.manifestSha256);
  });
  it("publishes an explicit manifest transition and preserves untouched bytes and frozen drafts", async () => {
    const value = await fixture();
    const original = await bytes(value.dataset);
    const draftBefore = await bytes(value.drafts);
    const result = await applyCurationDecision(value.input, value.options);
    expect(result).toMatchObject({ created: 3, replaced: 0, decisions: 1 });
    const output = await bytes(value.dataset);
    for (const [path, content] of Object.entries(original))
      if (
        ![
          "dataset-manifest.json",
          "reviews.jsonl",
          "curation-issues.jsonl",
        ].includes(path)
      )
        expect(output[path]).toBe(content);
    expect(await bytes(value.drafts)).toEqual(draftBefore);
    expect(
      (await validateCurationDataset(value.options)).structural.issues,
    ).toEqual([]);
    // The consumed pre-transaction draft remains stale, rather than having its approvals refreshed.
    expect(
      (await validateCurationDataset({ ...value.options, deep: true }))
        .sourceAudit.valid,
    ).toBe(false);
    const shown = await showCurationRecord(
      { packetId: field(value.packet, "id") },
      value.options,
    );
    expect(shown.decisions.packet).toHaveLength(1);
    await generateIntegratedReviewPackets(value.generatorOptions);
    expect(
      (await validateCurationDataset({ ...value.options, deep: true }))
        .sourceAudit.issues,
    ).toEqual([]);
    await rm(value.drafts, { recursive: true });
    await rm(value.grow, { recursive: true });
    expect(
      (await validateCurationDataset(value.options)).structural.valid,
    ).toBe(true);
  });
  it("rejects replay without changing committed bytes", async () => {
    const value = await fixture();
    await applyCurationDecision(value.input, value.options);
    const committed = await bytes(value.dataset);
    await expect(
      applyCurationDecision(value.input, value.options),
    ).rejects.toThrow();
    expect(await bytes(value.dataset)).toEqual(committed);
  });
  it.each([
    "draft",
    "scope",
    "queue",
    "packet",
    "comparison",
    "dependency",
    "run",
    "base",
    "manifest",
  ])(
    "rejects stale or corrupt %s without changing tracked bytes",
    async (kind) => {
      const value = await fixture();
      let input = value.input;
      const files: Record<string, string> = {
        draft: join(value.drafts, "draft-manifest.json"),
        scope: join(value.drafts, "review-scope.json"),
        queue: join(value.drafts, "integrated-review-queue.jsonl"),
        packet: join(value.drafts, "integrated-review-packets.jsonl"),
        comparison: join(value.drafts, "assertion-comparisons.jsonl"),
        run: join(value.crop, "importer-run-manifest.json"),
      };
      if (kind === "base")
        input = { ...input, baseDatasetSha256: "0".repeat(64) };
      else if (kind === "manifest")
        await writeJson(join(value.dataset, "dataset-manifest.json"), {
          ...value.manifest,
          scope: "Changed after review",
        });
      else if (kind === "dependency")
        input = {
          ...input,
          datasetManifest: {
            ...input.datasetManifest,
            dependencies: records(value.manifest.dependencies).map(
              (row, index) =>
                index === 0 ? { ...row, sha256: "0".repeat(64) } : row,
            ),
          },
        };
      else await writeFile(files[kind]!, "corrupt\n");
      const before = await bytes(value.dataset);
      await expect(
        applyCurationDecision(input, value.options),
      ).rejects.toThrow();
      expect(await bytes(value.dataset)).toEqual(before);
    },
  );
  it.each(["staged", "validated", "backed-up"] as const)(
    "restores exact bytes after failure at %s",
    async (phase) => {
      const value = await fixture();
      const before = await bytes(value.dataset);
      await expect(
        applyCurationDecision(value.input, {
          ...value.options,
          onPhase: (actual) =>
            actual === phase
              ? Promise.reject(new Error("Injected boundary failure"))
              : Promise.resolve(),
        }),
      ).rejects.toThrow("Injected boundary failure");
      expect(await bytes(value.dataset)).toEqual(before);
      expect(
        (await readdir(value.root)).filter(
          (name) =>
            name.startsWith(".curation-") || name.endsWith(".apply-lock"),
        ),
      ).toEqual([]);
    },
  );
  it("rejects concurrent apply while preserving an existing lock", async () => {
    const value = await fixture();
    await mkdir(`${value.dataset}.apply-lock`);
    const before = await bytes(value.dataset);
    await expect(
      applyCurationDecision(value.input, value.options),
    ).rejects.toThrow();
    expect(await bytes(value.dataset)).toEqual(before);
    expect(await readdir(`${value.dataset}.apply-lock`)).toEqual([]);
  });
  it("records issue replacements with an exact precondition and immutable previous value", async () => {
    const value = await fixture();
    await applyCurationDecision(value.input, value.options);
    await generateIntegratedReviewPackets(value.generatorOptions);
    const draft = await readIntegratedReviewDraft({
      directory: value.drafts,
      validationApi: value.options.validationApi,
    });
    const packet = draft.packets.find((row) => row.id === value.packet.id)!;
    const old = object(
      JSON.parse(
        (
          await readFile(join(value.dataset, "curation-issues.jsonl"), "utf8")
        ).trim(),
      ),
    );
    const receipt = object(
      JSON.parse(
        (
          await readFile(join(value.dataset, "packet-decisions.jsonl"), "utf8")
        ).trim(),
      ),
    );
    const manifest = object(
      JSON.parse(
        await readFile(join(value.dataset, "dataset-manifest.json"), "utf8"),
      ),
    );
    const input: IntegratedDecisionInput = {
      ...value.input,
      datasetManifest: manifest,
      transactionId: "transaction-resolution",
      draftManifestSha256: draft.manifestSha256,
      baseDatasetSha256: await authoringFingerprint(
        value.dataset,
        records(manifest.collections).map((row) => ({
          path: field(row, "path"),
        })),
      ),
      operations: [
        {
          ...value.operation,
          source: {
            ...value.operation.source,
            packetSha256: packet.contentSha256,
          },
          disposition: "accept",
          supersedesDecisionId: field(receipt, "id"),
          records: [
            {
              collection: "curation-issues",
              previousValueSha256: contentDigest(old),
              value: {
                ...old,
                status: "resolved",
                resolution: "Reviewed resolution",
              },
            },
          ],
        },
      ],
    };
    expect((await applyCurationDecision(input, value.options)).replaced).toBe(
      1,
    );
    const receipts = (
      await readFile(join(value.dataset, "packet-decisions.jsonl"), "utf8")
    )
      .trim()
      .split("\n")
      .map((line) => object(JSON.parse(line)));
    expect(
      records(
        receipts.find((row) => row.transactionId === input.transactionId)!
          .records,
      )[0]!.previousValue,
    ).toEqual(old);
  });
  it("expands explicit batches into individual stable decisions independent of member ordering", async () => {
    const value = await fixture();
    const second = {
      ...value.operation,
      mintAlias: "second-member",
      records: [
        {
          collection: "curation-issues",
          value: { ...value.operation.records[1]!.value, id: "issue-second" },
        },
      ],
    };
    const copy = join(value.root, "replica");
    await cp(value.dataset, copy, { recursive: true });
    const input = {
      ...value.input,
      operations: [],
      batches: [{ id: "batch-explicit", members: [value.operation, second] }],
    };
    expect((await applyCurationDecision(input, value.options)).decisions).toBe(
      2,
    );
    await applyCurationDecision(
      {
        ...input,
        batches: [{ id: "batch-explicit", members: [second, value.operation] }],
      },
      { ...value.options, datasetDirectory: copy },
    );
    expect(await bytes(value.dataset)).toEqual(await bytes(copy));
  });
  it("rejects mixed transactions with an invalid final member atomically", async () => {
    const value = await fixture();
    const before = await bytes(value.dataset);
    const invalid = {
      ...value.operation,
      mintAlias: "invalid-last",
      source: { ...value.operation.source, sourceRecordKey: value.cropKey },
    };
    await expect(
      applyCurationDecision(
        { ...value.input, operations: [value.operation, invalid] },
        value.options,
      ),
    ).rejects.toThrow("source key");
    expect(await bytes(value.dataset)).toEqual(before);
  });
  it("applies all seven decision kinds in one reviewed transaction and preserves cross-draft assertion lineage", async () => {
    const value = await localizationFixture();
    // A fixed transplant claim can be accepted; the default dynamic plant_now fixture cannot.
    const candidatePath = join(value.crop, "cultivation-candidates.jsonl");
    const staticCandidate = object(
      JSON.parse((await readFile(candidatePath, "utf8")).trim()),
    );
    Object.assign(object(staticCandidate.rawValue), { action: "transplant" });
    Object.assign(object(staticCandidate.value), {
      sourceAction: "transplant",
      action: "transplant",
      actionMapping: "identity",
    });
    const candidateBytes = Buffer.from(JSON.stringify(staticCandidate) + "\n");
    await writeFile(candidatePath, candidateBytes);
    const runPath = join(value.crop, "importer-run-manifest.json");
    const run = object(JSON.parse(await readFile(runPath, "utf8")));
    Object.assign(
      records(run.outputs).find(
        (row) => row.path === "cultivation-candidates.jsonl",
      )!,
      { sha256: digest(candidateBytes), byteSize: candidateBytes.length },
    );
    await writeJson(runPath, run);
    await generateIntegratedReviewPackets(value.generatorOptions);
    Object.assign(value, await rebase(value));
    const grow = value.draft.packets.find(
      (row) =>
        row.sourceKind === "grow" &&
        object(row.sourceRecordKey).recordId === "1",
    )!;
    const crop = value.draft.packets.find(
      (row) => row.sourceKind === "cropgraph",
    )!;
    const candidate = records(crop.cultivationCandidates)[0]!;
    const review = value.review;
    const rights = { ...review, id: "review-crop-rights", purpose: "rights" };
    const plant = {
      id: "plant-reviewed",
      status: "active",
      taxonId: "taxon-tomato",
      evidenceReferenceIds: ["evidence-wfo-tomato"],
    };
    const context = {
      id: "context-source",
      geographicScope: { type: "unknown" },
      growingSystem: "unknown",
      propagation: "unknown",
    };
    const evidence = await fixtureRecord(
      "catalog-evidence-reference-valid.json",
    );
    Object.assign(evidence, {
      id: "evidence-crop",
      sourceRecordKey: crop.sourceRecordKey,
      locator: (candidate.sourceLocators as string[])[0],
      normalization: {
        originalValue: candidate.rawValue,
        method: "Explicit reviewed source timing",
      },
      rights: {
        licenceId: object(
          JSON.parse(
            await readFile("data/sources/cropgraph/licence.json", "utf8"),
          ),
        ).id,
        decision: "eligible",
        reason: "Explicit fixture candidate rights review",
        reviewId: rights.id,
      },
    });
    const assertion = {
      id: "assertion-reviewed",
      subject: { type: "plant-concept", id: plant.id },
      predicate: "transplant_window",
      value: {
        type: "relative-day-window",
        anchor: "last_spring_frost",
        startOffsetDays: 21,
        endOffsetDays: 49,
      },
      contextId: context.id,
      evidenceReferenceIds: [evidence.id],
      reviewId: review.id,
    };
    const name = {
      id: "name-crop-reviewed",
      sourceRecordKey: crop.sourceRecordKey,
      sourceName: records(crop.taxonomyOutcomes)[0]!.sourceName,
      sourceLocator: object(records(crop.taxonomyOutcomes)[0]!.source)
        .sourceLocator,
      decision: "accept-candidate",
      externalTaxonomyCrosswalkId: value.crosswalk.id,
      reason: "Explicit WFO selection",
      reviewId: review.id,
    };
    const subject = {
      id: "subject-crop-reviewed",
      sourceRecordKey: crop.sourceRecordKey,
      sourceLocator: object(crop.sourceRecord).sourceLocator,
      decision: "map",
      subject: assertion.subject,
      externalTaxonomyCrosswalkId: value.crosswalk.id,
      reason: "Explicit horticultural subject",
      reviewId: review.id,
    };
    const assertionDecision = {
      id: "assertion-decision-reviewed",
      sourceCandidateId: candidate.id,
      draftManifestSha256: value.draft.manifestSha256,
      decision: "accept",
      reason: "Explicit source assertion",
      reviewId: review.id,
      assertionId: assertion.id,
      contextId: context.id,
    };
    const comparison = {
      id: "comparison-reviewed",
      comparisonId: value.draft.comparisons[0]!.id,
      draftManifestSha256: value.draft.manifestSha256,
      decision: "retain-both",
      reason: "Retain both claims",
      reviewId: review.id,
    };
    const operation = (
      kind: IntegratedDecisionOperation["kind"],
      packet: Readonly<Record<string, unknown>>,
      rows: IntegratedDecisionOperation["records"],
      extra: Record<string, unknown> = {},
    ): IntegratedDecisionOperation => ({
      kind,
      source: source(packet, extra),
      mintAlias: `operation-${kind}`,
      reviewId: review.id,
      disposition: "accept",
      reason: "Explicit reviewed fixture",
      records: rows,
    });
    const operations: IntegratedDecisionOperation[] = [
      operation("identity", crop, [
        { collection: "reviews", value: review },
        { collection: "source-name-decisions", value: name },
      ]),
      operation("subject", crop, [
        { collection: "plant-concepts", value: plant },
        { collection: "source-subject-mappings", value: subject },
      ]),
      {
        ...operation("localization", grow, [], {
          candidateIds: [value.proposal.id],
        }),
        disposition: "defer",
      },
      operation(
        "context",
        crop,
        [{ collection: "cultivation-contexts", value: context }],
        { candidateIds: [candidate.id] },
      ),
      operation(
        "assertion",
        crop,
        [
          { collection: "reviews", value: rights },
          { collection: "evidence-references", value: evidence },
          { collection: "assertions", value: assertion },
          {
            collection: "source-assertion-decisions",
            value: assertionDecision,
          },
        ],
        { candidateIds: [candidate.id] },
      ),
      operation(
        "comparison",
        grow,
        [{ collection: "assertion-comparison-decisions", value: comparison }],
        { comparisonIds: [comparison.comparisonId] },
      ),
      { ...value.operation, source: source(grow) },
    ];
    expect(
      (
        await applyCurationDecision(
          { ...value.input, operations },
          value.options,
        )
      ).decisions,
    ).toBe(7);
    await generateIntegratedReviewPackets(value.generatorOptions);
    const validation = await validateCurationDataset({
      ...value.options,
      deep: true,
    });
    expect(validation.structural.issues).toEqual([]);
    expect(validation.sourceAudit.issues).toEqual([]);
    const shown = await showCurationRecord(
      { packetId: field(crop, "id") },
      value.options,
    );
    expect(shown.decisions.assertion).toHaveLength(1);
    expect(shown.authored.assertions).toHaveLength(1);
  });
  it.each(["accept", "reject", "defer"] as const)(
    "preserves an explicit %s localization disposition",
    async (disposition) => {
      const value = await localizationFixture();
      const packet = value.draft.packets.find(
        (row) => records(row.localizationProposals).length > 0,
      )!;
      const candidate = object(value.proposal.candidate);
      const name = object(candidate.value);
      const evidence = await fixtureRecord(
        "catalog-evidence-reference-valid.json",
      );
      Object.assign(evidence, {
        id: "evidence-taxref",
        sourceRecordKey: candidate.sourceRecordKey,
        locator: (candidate.sourceLocators as string[])[0],
        rights: {
          licenceId: candidate.licenceId,
          decision: "eligible",
          reason: "Explicit TAXREF rights",
          reviewId: "review-taxref-rights",
        },
      });
      const rights = {
        ...value.review,
        id: "review-taxref-rights",
        purpose: "rights",
      };
      const localized = {
        id: "localized-reviewed",
        subject: { type: "taxon", id: value.proposal.taxonId },
        languageTag: name.languageTag,
        value: name.text,
        kind: "common",
        preferred: true,
        evidenceReferenceIds: [evidence.id],
      };
      const operation: IntegratedDecisionOperation = {
        kind: "localization",
        source: source(packet, { candidateIds: [value.proposal.id] }),
        mintAlias: "localization",
        reviewId: value.review.id,
        reason: "Explicit localization disposition",
        disposition,
        records: [
          { collection: "reviews", value: value.review },
          ...(disposition === "accept"
            ? [
                { collection: "reviews", value: rights },
                { collection: "evidence-references", value: evidence },
                { collection: "localized-names", value: localized },
              ]
            : []),
        ],
      };
      await applyCurationDecision(
        { ...value.input, operations: [operation] },
        value.options,
      );
      const shown = await showCurationRecord(
        { packetId: field(packet, "id") },
        value.options,
      );
      expect(shown.decisions.packet[0]!.disposition).toBe(disposition);
      expect(shown.authored.localizedNames).toHaveLength(
        disposition === "accept" ? 1 : 0,
      );
      await generateIntegratedReviewPackets(value.generatorOptions);
      expect(
        (await validateCurationDataset({ ...value.options, deep: true }))
          .sourceAudit.issues,
      ).toEqual([]);
    },
  );
  it("rechecks frozen inputs immediately before publication", async () => {
    const value = await fixture();
    const before = await bytes(value.dataset);
    await expect(
      applyCurationDecision(value.input, {
        ...value.options,
        onPhase: async (phase) => {
          if (phase === "validated")
            await writeFile(
              join(value.drafts, "integrated-review-packets.jsonl"),
              "changed after staging\n",
            );
        },
      }),
    ).rejects.toThrow("changed while");
    expect(await bytes(value.dataset)).toEqual(before);
  });
  it("refuses symlinked dataset files without touching their targets", async () => {
    const value = await fixture();
    const target = join(value.root, "external.txt");
    await writeFile(target, "external bytes");
    await symlink(target, join(value.dataset, "extra-link"));
    await expect(
      applyCurationDecision(value.input, value.options),
    ).rejects.toThrow("symlinked dataset");
    expect(await readFile(target, "utf8")).toBe("external bytes");
  });
  it("rejects unrelated authored records even when their schemas are valid", async () => {
    const value = await fixture();
    const before = await bytes(value.dataset);
    const operation = {
      ...value.operation,
      records: [
        ...value.operation.records,
        {
          collection: "reviews",
          value: { ...value.review, id: "unrelated-review" },
        },
      ],
    };
    await expect(
      applyCurationDecision(
        { ...value.input, operations: [operation] },
        value.options,
      ),
    ).rejects.toThrow("unrelated to operation");
    expect(await bytes(value.dataset)).toEqual(before);
  });
  it("requires explicit scope and source admission on the first integrated transaction", async () => {
    const value = await fixture();
    const before = await bytes(value.dataset);
    await expect(
      applyCurationDecision(
        {
          ...value.input,
          datasetManifest: {
            ...value.input.datasetManifest,
            scope: value.manifest.scope,
          },
        },
        value.options,
      ),
    ).rejects.toThrow("editorial scope");
    await expect(
      applyCurationDecision(
        {
          ...value.input,
          datasetManifest: {
            ...value.input.datasetManifest,
            dependencies: value.manifest.dependencies,
          },
        },
        value.options,
      ),
    ).rejects.toThrow("dependency admission");
    expect(await bytes(value.dataset)).toEqual(before);
  });
  it("rejects forged localization text and missing proposal provenance atomically", async () => {
    const value = await localizationFixture();
    const packet = value.draft.packets.find(
      (row) => records(row.localizationProposals).length > 0,
    )!;
    const before = await bytes(value.dataset);
    const operation: IntegratedDecisionOperation = {
      kind: "localization",
      source: source(packet, { candidateIds: [value.proposal.id] }),
      mintAlias: "forged-localization",
      reviewId: value.review.id,
      disposition: "accept",
      reason: "Fixture invalid localization",
      records: [
        { collection: "reviews", value: value.review },
        {
          collection: "localized-names",
          value: {
            id: "forged-localized",
            subject: { type: "taxon", id: value.proposal.taxonId },
            languageTag: "fr",
            value: "Different name",
            kind: "common",
            preferred: true,
            evidenceReferenceIds: ["evidence-wfo-tomato"],
          },
        },
      ],
    };
    await expect(
      applyCurationDecision(
        { ...value.input, operations: [operation] },
        value.options,
      ),
    ).rejects.toThrow("differs from frozen TAXREF");
    const expectedText = object(object(value.proposal.candidate).value).text;
    const correctText = {
      ...operation,
      records: operation.records.map((row) =>
        row.collection === "localized-names"
          ? { ...row, value: { ...row.value, value: expectedText } }
          : row,
      ),
    };
    await expect(
      applyCurationDecision(
        { ...value.input, operations: [correctText] },
        value.options,
      ),
    ).rejects.toThrow("TAXREF candidate provenance");
    expect(await bytes(value.dataset)).toEqual(before);
  });
  it.each(["reject", "defer"] as const)(
    "retains each %s assertion snapshot after regeneration",
    async (disposition) => {
      const value = await fixture();
      const packet = value.draft.packets.find(
        (row) => row.sourceKind === "cropgraph",
      )!;
      const candidate = records(packet.cultivationCandidates)[0]!;
      const operation: IntegratedDecisionOperation = {
        kind: "assertion",
        source: source(packet, { candidateIds: [candidate.id] }),
        mintAlias: "assertion-disposition",
        reviewId: value.review.id,
        disposition,
        reason: "Explicit source claim disposition",
        records: [
          { collection: "reviews", value: value.review },
          {
            collection: "source-assertion-decisions",
            value: {
              id: "individual-assertion-decision",
              sourceCandidateId: candidate.id,
              draftManifestSha256: value.draft.manifestSha256,
              reviewId: value.review.id,
              decision: disposition,
              reason: "Explicit source claim disposition",
            },
          },
        ],
      };
      await applyCurationDecision(
        { ...value.input, operations: [operation] },
        value.options,
      );
      await generateIntegratedReviewPackets(value.generatorOptions);
      expect(
        (await validateCurationDataset({ ...value.options, deep: true }))
          .sourceAudit.issues,
      ).toEqual([]);
      const shown = await showCurationRecord(
        { packetId: field(packet, "id") },
        value.options,
      );
      expect(shown.decisions.assertion[0]!.decision).toBe(disposition);
      expect(shown.decisions.packet[0]!.candidateSnapshots).toContainEqual(
        candidate,
      );
      expect(shown.authored.assertions).toEqual([]);
    },
  );
  it("maps a frozen source location while preserving its original country, name and locator", async () => {
    const value = await fixture();
    const path = join(value.grow, "candidates.jsonl");
    const candidate = object(JSON.parse((await readFile(path, "utf8")).trim()));
    Object.assign(object(object(candidate.applicability).geography), {
      sheetCode: "ATC",
      country: "Irland",
      name: "Irland (Cloughjordan)",
    });
    Object.assign(candidate, {
      sourceLocator: "PlantingCalendar.xlsx!ATC!B2:C2",
    });
    const candidateBytes = Buffer.from(JSON.stringify(candidate) + "\n");
    await writeFile(path, candidateBytes);
    const runPath = join(value.grow, "importer-run-manifest.json");
    const run = object(JSON.parse(await readFile(runPath, "utf8")));
    Object.assign(
      records(run.outputs).find((row) => row.path === "candidates.jsonl")!,
      { sha256: digest(candidateBytes), byteSize: candidateBytes.length },
    );
    await writeJson(runPath, run);
    await generateIntegratedReviewPackets(value.generatorOptions);
    const latest = await rebase(value);
    const packet = latest.draft.packets.find(
      (row) =>
        row.sourceKind === "grow" &&
        object(row.sourceRecordKey).recordId === "1",
    )!;
    const evidence = await fixtureRecord(
      "catalog-evidence-reference-valid.json",
    );
    Object.assign(evidence, {
      id: "evidence-geography",
      sourceRecordKey: packet.sourceRecordKey,
      locator: "PlantingCalendar.xlsx!ATC",
      rights: {
        licenceId: "licence_cc_by_4_0",
        decision: "eligible",
        reason: "Explicit geography evidence rights",
        reviewId: "review-geography-rights",
      },
    });
    const geography = {
      id: "geography-ireland",
      status: "active",
      kind: "source-location",
      name: "Ireland",
      evidenceReferenceIds: [evidence.id],
    };
    const mapping = await fixtureRecord(
      "authoring-source-geography-decision-valid.json",
    );
    mapping.reviewId = value.review.id;
    const operation: IntegratedDecisionOperation = {
      kind: "context",
      source: source(packet, { candidateIds: [candidate.id] }),
      mintAlias: "source-geography",
      reviewId: value.review.id,
      disposition: "accept",
      reason: "Explicit country spelling normalization",
      records: [
        { collection: "reviews", value: value.review },
        {
          collection: "reviews",
          value: {
            ...value.review,
            id: "review-geography-rights",
            purpose: "rights",
          },
        },
        { collection: "evidence-references", value: evidence },
        { collection: "geographic-contexts", value: geography },
        { collection: "source-geography-decisions", value: mapping },
      ],
    };
    const before = await bytes(value.dataset);
    const wrong = {
      ...operation,
      records: operation.records.map((row) =>
        row.collection === "source-geography-decisions"
          ? {
              ...row,
              value: {
                ...mapping,
                sourceLocation: {
                  ...object(mapping.sourceLocation),
                  name: "Changed source name",
                },
              },
            }
          : row,
      ),
    };
    await expect(
      applyCurationDecision(
        { ...latest.input, operations: [wrong] },
        value.options,
      ),
    ).rejects.toThrow("retain frozen country");
    expect(await bytes(value.dataset)).toEqual(before);
    await applyCurationDecision(
      { ...latest.input, operations: [operation] },
      value.options,
    );
    expect(
      (await validateCurationDataset(value.options)).structural.issues,
    ).toEqual([]);
  });
});
