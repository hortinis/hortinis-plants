import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { once } from "node:events";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { serializeCanonicalJson } from "../serialization/canonical-json.js";
import { readJsonLines } from "../serialization/json-lines.js";
import { validate, type ValidationApi } from "../schema/validation-api.js";
import {
  EXTERNAL_LINK_HEADERS,
  EXTERNAL_LINKS_MEMBER,
  TAXREF_ARCHIVE_LOCATOR,
  TAXREF_EXTERNAL_LINK_SCHEMA,
  TAXREF_LOCALIZATION_CANDIDATE_SCHEMA,
  TAXREF_SOURCE_ID,
  TAXREF_SOURCE_MANIFEST_ID,
  TAXREF_TAXONOMIC_RECORD_SCHEMA,
} from "../adapters/taxref/constants.js";
import {
  openTaxrefArchive,
  readTaxrefMember,
} from "../adapters/taxref/read-archive.js";
import { verifyTaxrefPin } from "../adapters/taxref/verify-pin.js";
import {
  WFO_SOURCE_ID,
  WFO_SOURCE_MANIFEST_ID,
  WFO_SOURCE_RELEASE_ID,
} from "../adapters/wfo/constants.js";
import { validateGrowWfoDataset } from "./grow-wfo-validation.js";

type RecordValue = Readonly<Record<string, unknown>>;

export type TaxrefWfoOutcome =
  "linked" | "ambiguous" | "not-found" | "concept-disagreement";

export interface TaxrefWfoLocalizationOptions {
  readonly datasetDirectory?: string;
  readonly taxrefRunDirectory: string;
  readonly wfoRunDirectory: string;
  readonly taxrefArchivePath: string;
  readonly outputDirectory: string;
  readonly taxrefSourceManifestPath?: string;
  readonly taxrefArchiveIndexPath?: string;
  readonly validationApi?: ValidationApi;
}

export interface TaxrefWfoLocalizationResult {
  readonly outputDirectory: string;
  readonly manifestSha256: string;
  readonly counts: readonly { readonly role: string; readonly count: number }[];
}

export interface TaxrefExternalLink {
  readonly sourceLocator: string;
  readonly recordNumber: number;
  readonly sourceAcronym: string;
  readonly sourceType: string;
  readonly sourceAuthors: string;
  readonly sourceTitle: string;
  readonly sourceUrl: string;
  readonly taxrefIdentifier: string;
  readonly externalIdentifier: string;
  readonly externalUrl: string;
}

export interface TaxrefTaxonRecord {
  readonly sourceRecordKey: RecordValue;
  readonly sourceLocator: string;
  readonly taxonomicStatus: "accepted" | "synonym";
  readonly acceptedTaxonIdentifier: string;
  readonly rank: RecordValue;
  readonly rawRecord: RecordValue;
}

export interface ReviewedWfoCrosswalk {
  readonly id: string;
  readonly taxonId: string;
  readonly externalIdentifier: RecordValue;
  readonly externalName: string;
  readonly taxonRank: string;
  readonly taxonomicStatus: string;
  readonly locator: string;
  readonly reviewId: string;
}

interface OutputStats {
  readonly path: string;
  readonly role: string;
  readonly schemaId: string;
  readonly sha256: string;
  readonly byteSize: number;
  readonly recordCount: number;
  readonly mediaType: "application/jsonl";
}

const LINK_OUTCOME_SCHEMA =
  "urn:hortinis:plants:schema:curation:v1:taxref-wfo-link-outcome";
const LOCALIZATION_PROPOSAL_SCHEMA =
  "urn:hortinis:plants:schema:curation:v1:taxref-localization-proposal";
const RUN_MANIFEST_SCHEMA =
  "urn:hortinis:plants:schema:v1:taxonomy-reconciliation-manifest";
const IMPORTER_RUN_SCHEMA =
  "urn:hortinis:plants:schema:v1:importer-run-manifest";
const WFO_RECONCILIATION_SCHEMA =
  "urn:hortinis:plants:schema:v1:taxonomy-reconciliation-manifest";
const DIAGNOSTIC_SCHEMA = "urn:hortinis:plants:schema:v1:import-diagnostic";

/**
 * Link current, accepted WFO crosswalks to TAXREF localization candidates.
 * This job creates review material only; it never writes authored catalog names.
 */
export async function reconcileTaxrefToReviewedWfo(
  options: TaxrefWfoLocalizationOptions,
): Promise<TaxrefWfoLocalizationResult> {
  const validationApi = options.validationApi ?? { validate };
  const repositoryRoot = resolve(
    fileURLToPath(new URL("../../", import.meta.url)),
  );
  const datasetDirectory = resolve(
    options.datasetDirectory ??
      join(repositoryRoot, "data/curation/grow-wfo-initial"),
  );
  const taxrefRunDirectory = resolve(options.taxrefRunDirectory);
  const wfoRunDirectory = resolve(options.wfoRunDirectory);
  const taxrefArchivePath = resolve(options.taxrefArchivePath);
  const outputDirectory = resolve(options.outputDirectory);
  const taxrefSourceManifestPath = resolve(
    options.taxrefSourceManifestPath ??
      join(repositoryRoot, "data/sources/taxref/source-manifest.json"),
  );
  const taxrefArchiveIndexPath = resolve(
    options.taxrefArchiveIndexPath ??
      join(repositoryRoot, "data/sources/taxref/archive-index.json"),
  );

  const datasetResult = await validateGrowWfoDataset({
    repositoryRoot,
    datasetDirectory,
    validationApi,
  });
  if (!datasetResult.valid || datasetResult.loaded === undefined) {
    throw new Error(
      `Curation dataset is not valid for TAXREF/WFO reconciliation: ${datasetResult.issues
        .slice(0, 5)
        .map((issue) => issue.message)
        .join("; ")}`,
    );
  }

  await verifyTaxrefPin({
    archivePath: taxrefArchivePath,
    sourceManifestPath: taxrefSourceManifestPath,
    archiveIndexPath: taxrefArchiveIndexPath,
  });

  const taxrefRunManifestPath = join(
    taxrefRunDirectory,
    "importer-run-manifest.json",
  );
  const wfoRunManifestPath = join(
    wfoRunDirectory,
    "reconciliation-run-manifest.json",
  );
  const taxrefRunManifest = await readJsonFile(taxrefRunManifestPath);
  const wfoRunManifest = await readJsonFile(wfoRunManifestPath);
  assertSchema(
    validationApi,
    IMPORTER_RUN_SCHEMA,
    taxrefRunManifest,
    taxrefRunManifestPath,
  );
  assertSchema(
    validationApi,
    WFO_RECONCILIATION_SCHEMA,
    wfoRunManifest,
    wfoRunManifestPath,
  );

  assertRunSource(taxrefRunManifest, TAXREF_SOURCE_MANIFEST_ID, "TAXREF");
  assertRunSource(wfoRunManifest, WFO_SOURCE_MANIFEST_ID, "WFO");
  await verifyRunOutput(
    taxrefRunManifest,
    taxrefRunDirectory,
    "taxonomic-records.jsonl",
  );
  await verifyRunOutput(
    taxrefRunManifest,
    taxrefRunDirectory,
    "localization-candidates.jsonl",
  );

  const currentCrosswalks = currentReviewedWfoCrosswalks(
    datasetResult.loaded.dataset.externalTaxonomyCrosswalks ?? [],
    datasetResult.loaded.dataset.taxa,
    datasetResult.loaded.dataset.reviews,
  );
  const wfoIdentifiers = new Set(
    currentCrosswalks.map((crosswalk) =>
      requiredString(crosswalk.externalIdentifier, "identifier"),
    ),
  );

  const links = await extractWfoExternalLinks(
    taxrefArchivePath,
    wfoIdentifiers,
  );
  const linksByWfoIdentifier = groupLinksByWfoIdentifier(links);
  const linkedTaxrefIdentifiers = new Set(
    links.map((link) => link.taxrefIdentifier),
  );
  const taxrefRecords =
    linkedTaxrefIdentifiers.size === 0
      ? new Map<string, TaxrefTaxonRecord>()
      : await readTaxrefTaxonomicRecords(
          join(taxrefRunDirectory, "taxonomic-records.jsonl"),
          linkedTaxrefIdentifiers,
          validationApi,
        );
  const acceptedTaxrefIdentifiers = new Set(
    [...taxrefRecords.values()].map((record) => record.acceptedTaxonIdentifier),
  );
  const localizationCandidates =
    acceptedTaxrefIdentifiers.size === 0
      ? []
      : await readTaxrefLocalizationCandidates(
          join(taxrefRunDirectory, "localization-candidates.jsonl"),
          acceptedTaxrefIdentifiers,
          validationApi,
        );

  const outcomes: RecordValue[] = [];
  const proposals: RecordValue[] = [];
  const diagnostics: RecordValue[] = [];
  for (const crosswalk of currentCrosswalks) {
    const wfoIdentifier = requiredString(
      crosswalk.externalIdentifier,
      "identifier",
    );
    const linksForIdentity = linksByWfoIdentifier.get(wfoIdentifier) ?? [];
    const result = classifyTaxrefWfoCrosswalk(
      crosswalk,
      linksForIdentity,
      taxrefRecords,
    );
    outcomes.push(result.outcome);
    for (const diagnostic of result.diagnostics) diagnostics.push(diagnostic);
    if (result.outcome.outcome === "linked") {
      const candidateIds = new Set(result.canonicalTaxrefIdentifiers);
      for (const candidate of localizationCandidates) {
        if (
          !candidateIds.has(
            requiredString(candidate, "acceptedTaxonIdentifier"),
          )
        )
          continue;
        const candidateId = requiredString(candidate, "id");
        proposals.push({
          id: stableId("taxref_localization_proposal", {
            taxonId: crosswalk.taxonId,
            crosswalkId: crosswalk.id,
            candidateId,
          }),
          taxonId: crosswalk.taxonId,
          wfoCrosswalkId: crosswalk.id,
          linkOutcomeId: requiredString(result.outcome, "id"),
          taxrefCandidateId: candidateId,
          candidate,
          reviewState: "unreviewed",
        });
      }
    }
  }

  outcomes.sort(compareId);
  proposals.sort(compareId);
  diagnostics.sort(compareDiagnostic);
  links.sort((left, right) =>
    `${left.externalIdentifier}\u0000${left.taxrefIdentifier}\u0000${left.sourceLocator}`.localeCompare(
      `${right.externalIdentifier}\u0000${right.taxrefIdentifier}\u0000${right.sourceLocator}`,
    ),
  );

  const parent = dirname(outputDirectory);
  await mkdir(parent, { recursive: true });
  const stagingDirectory = await mkdtemp(join(parent, ".taxref-wfo-"));
  try {
    const writers = [
      new JsonlWriter(
        join(stagingDirectory, "external-links.jsonl"),
        TAXREF_EXTERNAL_LINK_SCHEMA,
        validationApi,
      ),
      new JsonlWriter(
        join(stagingDirectory, "link-outcomes.jsonl"),
        LINK_OUTCOME_SCHEMA,
        validationApi,
      ),
      new JsonlWriter(
        join(stagingDirectory, "localization-proposals.jsonl"),
        LOCALIZATION_PROPOSAL_SCHEMA,
        validationApi,
      ),
      new JsonlWriter(
        join(stagingDirectory, "diagnostics.jsonl"),
        DIAGNOSTIC_SCHEMA,
        validationApi,
      ),
    ];
    try {
      for (const link of links)
        await writers[0]!.write(toExternalLinkRecord(link));
      for (const outcome of outcomes) await writers[1]!.write(outcome);
      for (const proposal of proposals) await writers[2]!.write(proposal);
      for (const diagnostic of diagnostics) await writers[3]!.write(diagnostic);
    } finally {
      await Promise.all(writers.map((writer) => writer.close()));
    }

    const outputStats = await Promise.all(
      writers.map((writer) => writer.stats()),
    );
    const inputPaths: readonly (readonly [string, string])[] = [
      ["dataset-manifest", join(datasetDirectory, "dataset-manifest.json")],
      ["taxref-run-manifest", taxrefRunManifestPath],
      ["wfo-run-manifest", wfoRunManifestPath],
      ["taxref-source-manifest", taxrefSourceManifestPath],
      ["taxref-archive-index", taxrefArchiveIndexPath],
      ["taxref-archive", taxrefArchivePath],
      [
        "dataset-crosswalks",
        join(datasetDirectory, "external-taxonomy-crosswalks.jsonl"),
      ],
      ["dataset-reviews", join(datasetDirectory, "reviews.jsonl")],
      ["dataset-taxa", join(datasetDirectory, "taxa.jsonl")],
    ];
    const inputs = await Promise.all(
      inputPaths.map(async ([role, path]) => {
        const metadata = await fileMetadata(path);
        return {
          role,
          locator: stableLocator(path, repositoryRoot),
          sha256: metadata.sha256,
          byteSize: metadata.byteSize,
        };
      }),
    );
    const configuration = {
      linkSource: "TAXREF_LIENS.txt",
      linkSourceAcronym: "WFO (World Flora Online)",
      nameFallback: "disabled",
      wfoIdentifierNormalization: "exact-v1",
      cropFormPolicy: "taxon-only",
    } as const;
    const configurationBytes = serializeCanonicalJson(configuration);
    const manifest = {
      schemaVersion: "1.0.0",
      job: { name: "taxref-wfo-localization", version: "0.1.0" },
      inputs: inputs.sort((left, right) => left.role.localeCompare(right.role)),
      configuration,
      configurationSha256: sha256(configurationBytes),
      tools: { node: process.version, csvParse: "6.2.1", unzipper: "0.10.14" },
      outputs: outputStats.sort((left, right) =>
        left.path.localeCompare(right.path),
      ),
      counts: [
        { role: "reviewed-wfo-identities", count: currentCrosswalks.length },
        { role: "taxref-external-links", count: links.length },
        {
          role: "linked",
          count: outcomes.filter((record) => record.outcome === "linked")
            .length,
        },
        {
          role: "ambiguous",
          count: outcomes.filter((record) => record.outcome === "ambiguous")
            .length,
        },
        {
          role: "not-found",
          count: outcomes.filter((record) => record.outcome === "not-found")
            .length,
        },
        {
          role: "concept-disagreement",
          count: outcomes.filter(
            (record) => record.outcome === "concept-disagreement",
          ).length,
        },
        { role: "localization-proposals", count: proposals.length },
        { role: "diagnostics", count: diagnostics.length },
      ],
    };
    assertSchema(validationApi, RUN_MANIFEST_SCHEMA, manifest, "T14 manifest");
    const manifestBytes = Buffer.concat([
      Buffer.from(serializeCanonicalJson(manifest)),
      Buffer.from("\n"),
    ]);
    await writeFile(
      join(stagingDirectory, "reconciliation-run-manifest.json"),
      manifestBytes,
      { flag: "wx" },
    );
    await publishDirectory(stagingDirectory, outputDirectory);
    return {
      outputDirectory,
      manifestSha256: sha256(manifestBytes),
      counts: manifest.counts,
    };
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true });
    throw error;
  }
}

function currentReviewedWfoCrosswalks(
  records: readonly RecordValue[],
  taxa: readonly RecordValue[],
  reviews: readonly RecordValue[],
): ReviewedWfoCrosswalk[] {
  const superseded = new Set(
    records
      .map((record) => stringField(record, "supersedesCrosswalkId"))
      .filter((value): value is string => value !== undefined),
  );
  const activeTaxa = new Set(
    taxa
      .filter((taxon) => stringField(taxon, "status") === "active")
      .map((taxon) => requiredString(taxon, "id")),
  );
  const acceptedReviews = new Set(
    reviews
      .filter(
        (review) =>
          stringField(review, "purpose") === "content" &&
          stringField(review, "status") === "accepted",
      )
      .map((review) => requiredString(review, "id")),
  );
  return records
    .filter((record) => !superseded.has(requiredString(record, "id")))
    .filter((record) => acceptedReviews.has(requiredString(record, "reviewId")))
    .filter((record) => activeTaxa.has(requiredString(record, "taxonId")))
    .filter((record) => {
      const external = asRecord(record.externalIdentifier);
      return (
        stringField(external, "sourceId") === WFO_SOURCE_ID &&
        stringField(external, "sourceManifestId") === WFO_SOURCE_MANIFEST_ID &&
        stringField(external, "sourceReleaseId") === WFO_SOURCE_RELEASE_ID &&
        stringField(record, "taxonomicStatus")?.toLocaleLowerCase("en") ===
          "accepted"
      );
    })
    .map((record) => ({
      id: requiredString(record, "id"),
      taxonId: requiredString(record, "taxonId"),
      externalIdentifier: asRecord(record.externalIdentifier)!,
      externalName: requiredString(record, "externalName"),
      taxonRank: requiredString(record, "taxonRank"),
      taxonomicStatus: requiredString(record, "taxonomicStatus"),
      locator: requiredString(record, "locator"),
      reviewId: requiredString(record, "reviewId"),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

async function extractWfoExternalLinks(
  archivePath: string,
  wfoIdentifiers: ReadonlySet<string>,
): Promise<TaxrefExternalLink[]> {
  const archive = await openTaxrefArchive(archivePath);
  const links: TaxrefExternalLink[] = [];
  for await (const row of readTaxrefMember(archive, {
    member: EXTERNAL_LINKS_MEMBER,
    headers: EXTERNAL_LINK_HEADERS,
    delimiter: "\t",
    encoding: "utf-8",
  })) {
    const record = row.record;
    if (record.CT_NAME !== "WFO (World Flora Online)") continue;
    if (!wfoIdentifiers.has(requiredString(record, "CT_SP_ID"))) continue;
    links.push({
      sourceLocator: `${TAXREF_ARCHIVE_LOCATOR}!/${EXTERNAL_LINKS_MEMBER}#record=${row.recordNumber}`,
      recordNumber: row.recordNumber,
      sourceAcronym: requiredString(record, "CT_NAME"),
      sourceType: requiredString(record, "CT_TYPE"),
      sourceAuthors: record.CT_AUTHORS ?? "",
      sourceTitle: requiredString(record, "CT_TITLE"),
      sourceUrl: requiredString(record, "CT_URL"),
      taxrefIdentifier: requiredString(record, "CD_NOM"),
      externalIdentifier: requiredString(record, "CT_SP_ID"),
      externalUrl: requiredString(record, "URL_SP"),
    });
  }
  return links;
}

function groupLinksByWfoIdentifier(
  links: readonly TaxrefExternalLink[],
): ReadonlyMap<string, readonly TaxrefExternalLink[]> {
  const grouped = new Map<string, TaxrefExternalLink[]>();
  for (const link of links) {
    const current = grouped.get(link.externalIdentifier) ?? [];
    current.push(link);
    grouped.set(link.externalIdentifier, current);
  }
  return grouped;
}

async function readTaxrefTaxonomicRecords(
  path: string,
  wantedIdentifiers: ReadonlySet<string>,
  validationApi: ValidationApi,
): Promise<ReadonlyMap<string, TaxrefTaxonRecord>> {
  const records = new Map<string, TaxrefTaxonRecord>();
  for await (const { value } of readJsonLines(createReadStream(path), {
    schemaId: TAXREF_TAXONOMIC_RECORD_SCHEMA,
    validationApi,
  })) {
    const record = asRecord(value);
    if (record === undefined)
      throw new Error(`${path} contains a non-object record`);
    const key = asRecord(record.sourceRecordKey);
    const identifier = stringField(key, "recordId");
    if (identifier === undefined || !wantedIdentifiers.has(identifier))
      continue;
    if (records.has(identifier))
      throw new Error(`TAXREF record ${identifier} is duplicated`);
    records.set(identifier, {
      sourceRecordKey: key!,
      sourceLocator: requiredString(record, "sourceLocator"),
      taxonomicStatus: requiredString(record, "taxonomicStatus") as
        "accepted" | "synonym",
      acceptedTaxonIdentifier: requiredString(
        record,
        "acceptedTaxonIdentifier",
      ),
      rank: asRecord(record.rank)!,
      rawRecord: asRecord(record.rawRecord)!,
    });
  }
  return records;
}

async function readTaxrefLocalizationCandidates(
  path: string,
  acceptedIdentifiers: ReadonlySet<string>,
  validationApi: ValidationApi,
): Promise<RecordValue[]> {
  const candidates: RecordValue[] = [];
  for await (const { value } of readJsonLines(createReadStream(path), {
    schemaId: TAXREF_LOCALIZATION_CANDIDATE_SCHEMA,
    validationApi,
  })) {
    const record = asRecord(value);
    if (record === undefined)
      throw new Error(`${path} contains a non-object record`);
    if (
      acceptedIdentifiers.has(requiredString(record, "acceptedTaxonIdentifier"))
    )
      candidates.push(record);
  }
  candidates.sort(compareId);
  return candidates;
}

export function classifyTaxrefWfoCrosswalk(
  crosswalk: ReviewedWfoCrosswalk,
  links: readonly TaxrefExternalLink[],
  taxrefRecords: ReadonlyMap<string, TaxrefTaxonRecord>,
): {
  readonly outcome: RecordValue;
  readonly canonicalTaxrefIdentifiers: readonly string[];
  readonly diagnostics: readonly RecordValue[];
} {
  const evidence = links.map((link) => ({
    kind: "taxref-external-link",
    sourceLocator: link.sourceLocator,
    taxrefIdentifier: link.taxrefIdentifier,
    externalIdentifier: link.externalIdentifier,
  }));
  const taxrefConcepts = new Map<string, TaxrefTaxonRecord>();
  const missing: string[] = [];
  for (const link of links) {
    const record = taxrefRecords.get(link.taxrefIdentifier);
    if (record === undefined) missing.push(link.taxrefIdentifier);
    else taxrefConcepts.set(record.acceptedTaxonIdentifier, record);
  }
  const diagnosticRecords: RecordValue[] = [];
  const base = {
    taxonId: crosswalk.taxonId,
    wfoCrosswalkId: crosswalk.id,
    wfoExternalIdentifier: crosswalk.externalIdentifier,
    taxrefSource: {
      sourceId: TAXREF_SOURCE_ID,
      sourceManifestId: TAXREF_SOURCE_MANIFEST_ID,
      sourceReleaseId: "18.0",
    },
    wfoIdentifier: requiredString(crosswalk.externalIdentifier, "identifier"),
    wfoLocator: crosswalk.locator,
    wfoReviewId: crosswalk.reviewId,
    wfoName: crosswalk.externalName,
    wfoRank: crosswalk.taxonRank,
    reviewState: "unreviewed",
  } as const;
  if (links.length === 0) {
    return {
      outcome: {
        id: outcomeId(crosswalk, "not-found"),
        ...base,
        outcome: "not-found",
        candidateTaxrefIdentifiers: [],
        evidence: [],
        diagnosticCodes: ["TAXREF_WFO_LINK_NOT_FOUND"],
      },
      canonicalTaxrefIdentifiers: [],
      diagnostics: [
        diagnostic(
          "TAXREF_WFO_LINK_NOT_FOUND",
          `No exact TAXREF WFO link was found for reviewed WFO identifier ${base.wfoIdentifier}.`,
          crosswalk.locator,
          { wfoIdentifier: base.wfoIdentifier, crosswalkId: crosswalk.id },
        ),
      ],
    };
  }
  if (missing.length > 0) {
    diagnosticRecords.push(
      diagnostic(
        "TAXREF_IDENTIFIER_NOT_FOUND",
        `TAXREF WFO link(s) reference missing taxonomic record(s): ${missing.join(", ")}.`,
        links[0]!.sourceLocator,
        { identifiers: missing },
      ),
    );
  }
  const canonicalIdentifiers = [...taxrefConcepts.keys()].sort();
  const incompatible = canonicalIdentifiers.some((identifier) => {
    const record = taxrefConcepts.get(identifier)!;
    return (
      !rankCompatible(
        crosswalk.taxonRank,
        stringField(record.rank, "labelEnglish"),
        stringField(record.rank, "label"),
      ) ||
      !nameCompatible(
        crosswalk.externalName,
        stringField(record.rawRecord, "LB_NOM"),
        stringField(record.rawRecord, "NOM_VALIDE"),
      )
    );
  });
  const outcome: TaxrefWfoOutcome =
    canonicalIdentifiers.length === 0
      ? "not-found"
      : canonicalIdentifiers.length > 1
        ? incompatible
          ? "concept-disagreement"
          : "ambiguous"
        : incompatible
          ? "concept-disagreement"
          : "linked";
  if (outcome === "ambiguous") {
    diagnosticRecords.push(
      diagnostic(
        "TAXREF_WFO_LINK_AMBIGUOUS",
        `Reviewed WFO identifier ${base.wfoIdentifier} maps to multiple TAXREF accepted concepts.`,
        crosswalk.locator,
        { acceptedTaxrefIdentifiers: canonicalIdentifiers },
      ),
    );
  }
  if (outcome === "concept-disagreement") {
    diagnosticRecords.push(
      diagnostic(
        "TAXREF_WFO_CONCEPT_DISAGREEMENT",
        `TAXREF and reviewed WFO identity disagree on the accepted concept, rank or scientific name for ${base.wfoIdentifier}.`,
        crosswalk.locator,
        { acceptedTaxrefIdentifiers: canonicalIdentifiers },
      ),
    );
  }
  if (outcome === "not-found" && missing.length === 0) {
    diagnosticRecords.push(
      diagnostic(
        "TAXREF_WFO_LINK_NOT_FOUND",
        `TAXREF WFO links for ${base.wfoIdentifier} did not resolve to a taxonomic concept.`,
        crosswalk.locator,
        {},
      ),
    );
  }
  return {
    outcome: {
      id: outcomeId(crosswalk, outcome),
      ...base,
      outcome,
      candidateTaxrefIdentifiers: canonicalIdentifiers,
      evidence,
      ...(diagnosticRecords.length === 0
        ? {}
        : {
            diagnosticCodes: diagnosticRecords.map((record) =>
              requiredString(record, "code"),
            ),
          }),
    },
    canonicalTaxrefIdentifiers:
      outcome === "linked" ? canonicalIdentifiers : [],
    diagnostics: diagnosticRecords,
  };
}

function toExternalLinkRecord(link: TaxrefExternalLink): RecordValue {
  return {
    sourceLocator: link.sourceLocator,
    recordNumber: link.recordNumber,
    sourceAcronym: link.sourceAcronym,
    sourceType: link.sourceType,
    sourceAuthors: link.sourceAuthors,
    sourceTitle: link.sourceTitle,
    sourceUrl: link.sourceUrl,
    taxrefIdentifier: link.taxrefIdentifier,
    externalIdentifier: link.externalIdentifier,
    externalUrl: link.externalUrl,
  };
}

function rankCompatible(
  wfoRank: string,
  englishRank: string | undefined,
  frenchRank: string | undefined,
): boolean {
  const normalize = (value: string): string =>
    value
      .normalize("NFC")
      .trim()
      .toLocaleLowerCase("en")
      .replaceAll("é", "e")
      .replaceAll("è", "e")
      .replaceAll(" ", "-");
  const left = normalize(wfoRank);
  const right = normalize(englishRank ?? frenchRank ?? "");
  if (right.length === 0) return true;
  const aliases: Readonly<Record<string, string>> = {
    subspecies: "subspecies",
    "sous-espece": "subspecies",
    variety: "variety",
    variete: "variety",
    species: "species",
    espece: "species",
    genus: "genus",
    genre: "genus",
  };
  return (aliases[left] ?? left) === (aliases[right] ?? right);
}

function nameCompatible(
  wfoName: string,
  taxrefBase: string | undefined,
  taxrefValid: string | undefined,
): boolean {
  const normalize = (value: string): string =>
    value.normalize("NFC").trim().replace(/\s+/gu, " ");
  const left = normalize(wfoName);
  return (
    left === normalize(taxrefBase ?? "") ||
    left === normalize(taxrefValid ?? "")
  );
}

function outcomeId(
  crosswalk: ReviewedWfoCrosswalk,
  outcome: TaxrefWfoOutcome,
): string {
  return stableId("taxref_wfo_outcome", { crosswalkId: crosswalk.id, outcome });
}

function stableId(prefix: string, value: unknown): string {
  return `${prefix}_${createHash("sha256")
    .update(serializeCanonicalJson(value))
    .digest("hex")}`;
}

function diagnostic(
  code: string,
  message: string,
  sourceLocator: string,
  details: RecordValue,
): RecordValue {
  return { kind: "unresolved-mapping", code, message, sourceLocator, details };
}

class JsonlWriter {
  readonly #stream;
  readonly #hash = createHash("sha256");
  readonly #path: string;
  readonly #schemaId: string;
  readonly #validationApi: ValidationApi;
  #recordCount = 0;
  #closed = false;

  constructor(path: string, schemaId: string, validationApi: ValidationApi) {
    this.#path = path;
    this.#schemaId = schemaId;
    this.#validationApi = validationApi;
    this.#stream = createWriteStream(path, { flags: "wx" });
  }

  async write(value: RecordValue): Promise<void> {
    const result = this.#validationApi.validate(this.#schemaId, value);
    if (!result.valid)
      throw new Error(
        `T14 output failed ${this.#schemaId}: ${JSON.stringify(result.errors)}`,
      );
    const framed = Buffer.concat([
      Buffer.from(serializeCanonicalJson(value)),
      Buffer.from("\n"),
    ]);
    if (!this.#stream.write(framed)) await once(this.#stream, "drain");
    this.#hash.update(framed);
    this.#recordCount += 1;
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#stream.end();
    await once(this.#stream, "close");
  }

  async stats(): Promise<OutputStats> {
    const metadata = await stat(this.#path);
    return {
      path: this.#path.split("/").pop()!,
      role: this.#schemaId === DIAGNOSTIC_SCHEMA ? "diagnostics" : "auxiliary",
      schemaId: this.#schemaId,
      sha256: this.#hash.digest("hex"),
      byteSize: metadata.size,
      recordCount: this.#recordCount,
      mediaType: "application/jsonl",
    };
  }
}

async function readJsonFile(path: string): Promise<RecordValue> {
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  const record = asRecord(value);
  if (record === undefined)
    throw new Error(`${path} must contain a JSON object`);
  return record;
}

function assertSchema(
  validationApi: ValidationApi,
  schemaId: string,
  value: unknown,
  label: string,
): void {
  const result = validationApi.validate(schemaId, value);
  if (!result.valid)
    throw new Error(
      `${label} failed ${schemaId}: ${JSON.stringify(result.errors)}`,
    );
}

function assertRunSource(
  manifest: RecordValue,
  expectedId: string,
  label: string,
): void {
  const direct = asRecord(manifest.sourceManifest);
  const inputs = Array.isArray(manifest.inputs)
    ? manifest.inputs
        .map(asRecord)
        .filter((value): value is RecordValue => value !== undefined)
    : [];
  const found =
    stringField(direct, "id") === expectedId ||
    inputs.some((input) => stringField(input, "id") === expectedId);
  if (!found)
    throw new Error(
      `${label} run does not reference expected source manifest ${expectedId}`,
    );
}

async function verifyRunOutput(
  manifest: RecordValue,
  runDirectory: string,
  relativePath: string,
): Promise<void> {
  const outputs = Array.isArray(manifest.outputs)
    ? manifest.outputs
        .map(asRecord)
        .filter((value): value is RecordValue => value !== undefined)
    : [];
  const descriptor = outputs.find(
    (output) => stringField(output, "path") === relativePath,
  );
  if (descriptor === undefined)
    throw new Error(`Run manifest does not describe ${relativePath}`);
  const path = join(runDirectory, relativePath);
  const metadata = await fileMetadata(path);
  if (
    metadata.sha256 !== requiredString(descriptor, "sha256") ||
    metadata.byteSize !== descriptor.byteSize
  ) {
    throw new Error(
      `Run output ${relativePath} does not match its manifest descriptor`,
    );
  }
}

async function fileMetadata(
  path: string,
): Promise<{ readonly sha256: string; readonly byteSize: number }> {
  const hash = createHash("sha256");
  let byteSize = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
    byteSize += (chunk as Buffer).byteLength;
  }
  return { sha256: hash.digest("hex"), byteSize };
}

async function publishDirectory(
  staging: string,
  destination: string,
): Promise<void> {
  const backup = `${destination}.backup-${Date.now()}`;
  let movedOld = false;
  try {
    await access(destination);
    await rename(destination, backup);
    movedOld = true;
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }
  try {
    await rename(staging, destination);
  } catch (error) {
    if (movedOld) await rename(backup, destination);
    throw error;
  }
  if (movedOld) await rm(backup, { recursive: true, force: true });
}

function compareId(left: RecordValue, right: RecordValue): number {
  return requiredString(left, "id").localeCompare(requiredString(right, "id"));
}

function compareDiagnostic(left: RecordValue, right: RecordValue): number {
  return `${requiredString(left, "code")}\u0000${requiredString(left, "sourceLocator")}`.localeCompare(
    `${requiredString(right, "code")}\u0000${requiredString(right, "sourceLocator")}`,
  );
}

function asRecord(value: unknown): RecordValue | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : undefined;
}

function stringField(
  record: RecordValue | undefined,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function requiredString(record: RecordValue | undefined, key: string): string {
  const value = stringField(record, key);
  if (value === undefined) throw new Error(`Record is missing string ${key}`);
  return value;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function isMissingFile(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function stableLocator(path: string, repositoryRoot: string): string {
  const relativePath = relative(repositoryRoot, path).split(sep).join("/");
  return relativePath.length > 0 && !relativePath.startsWith("../")
    ? relativePath
    : path;
}
