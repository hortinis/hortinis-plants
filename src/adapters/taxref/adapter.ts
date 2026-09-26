import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import {
  makeQualifiedSourceRecordKey,
  makeSourceReleaseKey,
} from "../../domain/source-keys.js";
import { runImporter } from "../../importer/runner.js";
import type { ImportEvent, ImporterDefinition } from "../../importer/types.js";
import { serializeCanonicalJson } from "../../serialization/canonical-json.js";
import type { ValidationApi } from "../../schema/validation-api.js";
import { makeTaxrefLocalizationCandidate } from "./candidates.js";
import {
  CHANGES_MEMBER,
  CHANGE_HEADERS,
  HABITATS_MEMBER,
  HABITAT_HEADERS,
  IMPORT_DIAGNOSTIC_SCHEMA,
  RANKS_MEMBER,
  RANK_HEADERS,
  REMOVED_HEADERS,
  REMOVED_MEMBER,
  STATUSES_MEMBER,
  STATUS_HEADERS,
  TAXONOMY_HEADERS,
  TAXONOMY_MEMBER,
  TAXREF_ARCHIVE_LOCATOR,
  TAXREF_CHANGE_RECORD_SCHEMA,
  TAXREF_LOCALIZATION_CANDIDATE_SCHEMA,
  TAXREF_RELEASE_ID,
  TAXREF_REMOVED_IDENTIFIER_SCHEMA,
  TAXREF_SOURCE_ID,
  TAXREF_SOURCE_MANIFEST_ID,
  TAXREF_TAXONOMIC_RECORD_SCHEMA,
  TAXREF_VERNACULAR_RECORD_SCHEMA,
  TAXREF_VOCABULARY_RECORD_SCHEMA,
  TERRITORY_FIELDS,
  VERNACULAR_HEADERS,
  VERNACULAR_MEMBER,
} from "./constants.js";
import {
  openTaxrefArchive,
  readTaxrefMember,
  type TaxrefArchive,
} from "./read-archive.js";
import type {
  PendingFrenchVernacular,
  TaxrefDiagnostic,
  TaxrefRawRecord,
  TaxrefTaxonIndexEntry,
  TaxrefTerritoryStatus,
  TaxrefVocabularyRecord,
} from "./types.js";
import { verifyTaxrefPin } from "./verify-pin.js";

const defaultSourceManifestPath = resolve(
  "data/sources/taxref/source-manifest.json",
);
const defaultArchiveIndexPath = resolve(
  "data/sources/taxref/archive-index.json",
);

interface VocabularyValue {
  readonly code: string;
  readonly label: string;
  readonly labelEnglish?: string;
  readonly level?: string;
}

interface ImportCounts {
  taxonomicRecords: number;
  vernacularRecords: number;
  localizationCandidates: number;
  changeRecords: number;
  removedIdentifiers: number;
  vocabularyRecords: number;
  diagnostics: number;
}

export interface TaxrefImportOptions {
  readonly archivePath: string;
  readonly outputDirectory: string;
  readonly sourceManifestPath?: string;
  readonly archiveIndexPath?: string;
  readonly validationApi?: ValidationApi;
}

export async function importTaxrefSource(options: TaxrefImportOptions) {
  const archivePath = resolve(options.archivePath);
  const sourceManifestPath = resolve(
    options.sourceManifestPath ?? defaultSourceManifestPath,
  );
  const archiveIndexPath = resolve(
    options.archiveIndexPath ?? defaultArchiveIndexPath,
  );
  await verifyTaxrefPin({
    archivePath,
    sourceManifestPath,
    archiveIndexPath,
  });
  const archiveIndexBytes = await readFile(archiveIndexPath);
  const importer: ImporterDefinition<{
    readonly archiveIndexSha256: string;
    readonly languageMapping: "ISO-639-3-fra-to-BCP-47-fr";
    readonly externalLinksMaterialized: false;
    readonly missingParentPolicy: "diagnostic";
  }> = {
    name: "taxref-localization-staging",
    version: "0.1.0",
    configuration: {
      archiveIndexSha256: sha256(archiveIndexBytes),
      languageMapping: "ISO-639-3-fra-to-BCP-47-fr",
      externalLinksMaterialized: false,
      missingParentPolicy: "diagnostic",
    },
    inputs: [
      {
        locator: TAXREF_ARCHIVE_LOCATOR,
        path: basename(archivePath),
        role: "upstream",
      },
    ],
    outputs: [
      output("taxonomic-records", TAXREF_TAXONOMIC_RECORD_SCHEMA),
      output("vernacular-records", TAXREF_VERNACULAR_RECORD_SCHEMA),
      output("localization-candidates", TAXREF_LOCALIZATION_CANDIDATE_SCHEMA),
      output("change-records", TAXREF_CHANGE_RECORD_SCHEMA),
      output("removed-identifiers", TAXREF_REMOVED_IDENTIFIER_SCHEMA),
      output("vocabularies", TAXREF_VOCABULARY_RECORD_SCHEMA),
      {
        name: "inventory",
        path: "inventory.jsonl",
        role: "auxiliary",
        mediaType: "application/jsonl",
      },
      {
        name: "diagnostics",
        path: "diagnostics.jsonl",
        role: "diagnostics",
        mediaType: "application/jsonl",
        schemaId: IMPORT_DIAGNOSTIC_SCHEMA,
      },
    ],
    tools: { unzipper: "0.10.14", csvParse: "6.2.1" },
    async *run(context): AsyncIterable<ImportEvent> {
      assertSourceManifest(context.sourceManifest);
      const archive = await openTaxrefArchive(
        context.resourcePath(TAXREF_ARCHIVE_LOCATOR),
      );
      const source = makeSourceReleaseKey(
        TAXREF_SOURCE_ID,
        TAXREF_SOURCE_MANIFEST_ID,
        TAXREF_RELEASE_ID,
      );
      const counts: ImportCounts = {
        taxonomicRecords: 0,
        vernacularRecords: 0,
        localizationCandidates: 0,
        changeRecords: 0,
        removedIdentifiers: 0,
        vocabularyRecords: 0,
        diagnostics: 0,
      };

      const ranks = new Map<string, VocabularyValue>();
      const habitats = new Map<string, VocabularyValue>();
      const statuses = new Map<string, VocabularyValue>();
      for await (const event of readVocabularies(
        archive,
        ranks,
        habitats,
        statuses,
      )) {
        counts.vocabularyRecords += 1;
        yield event;
      }

      const pendingFrench = new Map<string, PendingFrenchVernacular[]>();
      const vernacularTargets = new Map<
        string,
        { readonly identifier: string; readonly sourceLocator: string }
      >();
      const vernacularIds = new Set<string>();
      for await (const row of readTaxrefMember(archive, {
        member: VERNACULAR_MEMBER,
        headers: VERNACULAR_HEADERS,
        delimiter: "\t",
        encoding: "utf-8",
      })) {
        const id = requiredIdentifier(
          row.record,
          "CD_VERN",
          VERNACULAR_MEMBER,
          row.recordNumber,
        );
        const taxonId = requiredIdentifier(
          row.record,
          "CD_NOM",
          VERNACULAR_MEMBER,
          row.recordNumber,
        );
        if (vernacularIds.has(id)) {
          throw new Error(`Duplicate TAXREF vernacular identifier ${id}`);
        }
        vernacularIds.add(id);
        const sourceLocator = locator(VERNACULAR_MEMBER, row.recordNumber);
        const sourceRecordKey = makeQualifiedSourceRecordKey(source, id);
        if (!vernacularTargets.has(taxonId)) {
          vernacularTargets.set(taxonId, {
            identifier: id,
            sourceLocator,
          });
        }
        counts.vernacularRecords += 1;
        yield {
          output: "vernacular-records",
          value: {
            sourceRecordKey,
            sourceLocator,
            recordNumber: row.recordNumber,
            targetTaxonIdentifier: taxonId,
            rawRecord: row.record,
          },
        };
        const iso = row.record.ISO639_3 ?? "";
        const language = row.record.LANGUE ?? "";
        if (iso === "fra" && language === "Français") {
          const items = pendingFrench.get(taxonId) ?? [];
          items.push({
            sourceRecordKey,
            sourceLocator: fieldLocator(
              VERNACULAR_MEMBER,
              row.recordNumber,
              "LB_VERN",
            ),
            text: row.record.LB_VERN ?? "",
            country: row.record.PAYS ?? "",
            sourceLanguage: language,
          });
          pendingFrench.set(taxonId, items);
        } else if (iso === "fra" || language === "Français") {
          counts.diagnostics += 1;
          yield {
            output: "diagnostics",
            value: diagnostic(
              "unresolved-mapping",
              "FRENCH_LANGUAGE_FIELDS_DISAGREE",
              "A vernacular row has only one of the expected French language markers; no localization candidate was emitted.",
              sourceLocator,
              { iso6393: iso, language },
              sourceRecordKey,
            ),
          };
        }
      }

      const taxonIndex = new Map<string, TaxrefTaxonIndexEntry>();
      for await (const row of readTaxrefMember(archive, {
        member: TAXONOMY_MEMBER,
        headers: TAXONOMY_HEADERS,
        delimiter: "\t",
        encoding: "utf-8",
      })) {
        const id = requiredIdentifier(
          row.record,
          "CD_NOM",
          TAXONOMY_MEMBER,
          row.recordNumber,
        );
        const referenceIdentifier = requiredIdentifier(
          row.record,
          "CD_REF",
          TAXONOMY_MEMBER,
          row.recordNumber,
        );
        if (taxonIndex.has(id)) {
          throw new Error(`Duplicate TAXREF taxonomic identifier ${id}`);
        }
        const rankCode = requiredValue(
          row.record,
          "RANG",
          TAXONOMY_MEMBER,
          row.recordNumber,
        );
        const rank = ranks.get(rankCode);
        if (rank === undefined) {
          throw new Error(`Unknown TAXREF rank ${rankCode} for CD_NOM ${id}`);
        }
        const habitatCode = row.record.HABITAT ?? "";
        if (habitatCode !== "" && !habitats.has(habitatCode)) {
          throw new Error(
            `Unknown TAXREF habitat ${habitatCode} for CD_NOM ${id}`,
          );
        }
        const sourceLocator = locator(TAXONOMY_MEMBER, row.recordNumber);
        const sourceRecordKey = makeQualifiedSourceRecordKey(source, id);
        const territoryStatuses = territoryStatusValues(
          row.record,
          row.recordNumber,
          statuses,
        );
        taxonIndex.set(id, {
          referenceIdentifier,
          parentIdentifier: row.record.CD_SUP ?? "",
          simplifiedParentIdentifier: row.record.CD_TAXSUP ?? "",
          sourceLocator,
        });
        counts.taxonomicRecords += 1;
        yield {
          output: "taxonomic-records",
          value: {
            sourceRecordKey,
            sourceLocator,
            recordNumber: row.recordNumber,
            taxonomicStatus:
              id === referenceIdentifier ? "accepted" : "synonym",
            acceptedTaxonIdentifier: referenceIdentifier,
            rank: {
              code: rank.code,
              level: rank.level ?? "",
              label: rank.label,
              labelEnglish: rank.labelEnglish ?? "",
            },
            territoryStatuses,
            rawRecord: row.record,
          },
        };

        const mainFrench = row.record.NOM_VERN ?? "";
        if (mainFrench !== "") {
          counts.localizationCandidates += 1;
          yield {
            output: "localization-candidates",
            value: makeTaxrefLocalizationCandidate({
              sourceRecordKey,
              targetTaxonRecordKey: sourceRecordKey,
              acceptedTaxonIdentifier: referenceIdentifier,
              sourceLocator: fieldLocator(
                TAXONOMY_MEMBER,
                row.recordNumber,
                "NOM_VERN",
              ),
              citationLocator: sourceLocator,
              field: "NOM_VERN",
              text: mainFrench,
              sourceLanguage: "French vernacular field",
              languageVerification: "taxref-french-field-contract",
              territoryStatuses,
            }),
          };
        }
        for (const vernacular of pendingFrench.get(id) ?? []) {
          counts.localizationCandidates += 1;
          yield {
            output: "localization-candidates",
            value: makeTaxrefLocalizationCandidate({
              sourceRecordKey: vernacular.sourceRecordKey,
              targetTaxonRecordKey: sourceRecordKey,
              acceptedTaxonIdentifier: referenceIdentifier,
              sourceLocator: vernacular.sourceLocator,
              citationLocator: vernacular.sourceLocator,
              field: "LB_VERN",
              text: vernacular.text,
              sourceLanguage: vernacular.sourceLanguage,
              languageVerification: "taxref-iso639-3-and-label",
              country: vernacular.country,
              territoryStatuses,
            }),
          };
        }
        pendingFrench.delete(id);
        vernacularTargets.delete(id);
      }
      if (vernacularTargets.size > 0) {
        const [missingTaxonId, example] = vernacularTargets.entries().next()
          .value ?? ["unknown", undefined];
        throw new Error(
          `TAXREF vernacular records reference ${vernacularTargets.size} missing taxonomic target(s), including ${missingTaxonId} from vernacular record ${example?.identifier ?? "unknown"} at ${example?.sourceLocator ?? "unknown"}`,
        );
      }

      for (const value of validateTaxonGraph(taxonIndex)) {
        counts.diagnostics += 1;
        yield { output: "diagnostics", value };
      }

      const changeKeys = new Set<string>();
      for await (const row of readTaxrefMember(archive, {
        member: CHANGES_MEMBER,
        headers: CHANGE_HEADERS,
        delimiter: "\t",
        encoding: "utf-8",
      })) {
        const key = `change_${sha256(Buffer.from(serializeCanonicalJson(row.record)))}`;
        if (changeKeys.has(key)) {
          throw new Error(`Duplicate TAXREF change claim ${key}`);
        }
        changeKeys.add(key);
        counts.changeRecords += 1;
        yield {
          output: "change-records",
          value: {
            id: key,
            sourceRecordKey: makeQualifiedSourceRecordKey(source, key),
            sourceLocator: locator(CHANGES_MEMBER, row.recordNumber),
            recordNumber: row.recordNumber,
            taxonIdentifier: requiredIdentifier(
              row.record,
              "CD_NOM",
              CHANGES_MEMBER,
              row.recordNumber,
            ),
            rawRecord: row.record,
          },
        };
      }

      const removedIds = new Set<string>();
      for await (const row of readTaxrefMember(archive, {
        member: REMOVED_MEMBER,
        headers: REMOVED_HEADERS,
        delimiter: "\t",
        encoding: "utf-8",
      })) {
        const id = requiredIdentifier(
          row.record,
          "CD_NOM",
          REMOVED_MEMBER,
          row.recordNumber,
        );
        if (removedIds.has(id)) {
          throw new Error(`Duplicate removed TAXREF identifier ${id}`);
        }
        if (taxonIndex.has(id)) {
          throw new Error(`Removed TAXREF identifier ${id} is also current`);
        }
        removedIds.add(id);
        const replacement = row.record.CD_NOM_REMPLACEMENT ?? "";
        if (replacement !== "" && !taxonIndex.has(replacement)) {
          throw new Error(
            `Removed TAXREF identifier ${id} has missing replacement ${replacement}`,
          );
        }
        counts.removedIdentifiers += 1;
        yield {
          output: "removed-identifiers",
          value: {
            sourceRecordKey: makeQualifiedSourceRecordKey(source, id),
            sourceLocator: locator(REMOVED_MEMBER, row.recordNumber),
            recordNumber: row.recordNumber,
            identifier: id,
            ...(replacement === ""
              ? {}
              : { replacementTaxonIdentifier: replacement }),
            rawRecord: row.record,
          },
        };
      }

      yield {
        output: "inventory",
        value: {
          sourceReleaseId: TAXREF_RELEASE_ID,
          archiveIndexSha256: context.configuration.archiveIndexSha256,
          counts,
          externalLinksMaterialized: false,
          excludedMember: "TAXREF_LIENS.txt",
          excludedMemberReason:
            "T12 stages TAXREF localization and identifier history; external database links are outside its accepted output contract.",
        },
      };
    },
  };
  return runImporter({
    importer,
    sourceManifestPath,
    resourceDirectory: dirname(archivePath),
    outputDirectory: resolve(options.outputDirectory),
    ...(options.validationApi === undefined
      ? {}
      : { validationApi: options.validationApi }),
  });
}

async function* readVocabularies(
  archive: TaxrefArchive,
  ranks: Map<string, VocabularyValue>,
  habitats: Map<string, VocabularyValue>,
  statuses: Map<string, VocabularyValue>,
): AsyncGenerator<ImportEvent> {
  for await (const row of readTaxrefMember(archive, {
    member: RANKS_MEMBER,
    headers: RANK_HEADERS,
    delimiter: ";",
    encoding: "windows-1252",
  })) {
    const code = vocabularyCode(
      row.record,
      "RANG",
      RANKS_MEMBER,
      row.recordNumber,
    );
    const value = {
      code,
      level: row.record.RG_LEVEL ?? "",
      label: row.record.DETAIL ?? "",
      labelEnglish: row.record.DETAIL_EN ?? "",
    };
    insertVocabulary(ranks, value, RANKS_MEMBER);
    yield vocabularyEvent(
      "rank",
      code,
      RANKS_MEMBER,
      row.recordNumber,
      row.record,
    );
  }
  for await (const row of readTaxrefMember(archive, {
    member: HABITATS_MEMBER,
    headers: HABITAT_HEADERS,
    delimiter: ";",
    encoding: "windows-1252",
  })) {
    const code = vocabularyCode(
      row.record,
      "HABITAT",
      HABITATS_MEMBER,
      row.recordNumber,
    );
    const value = { code, label: row.record.LB_HABITAT ?? "" };
    insertVocabulary(habitats, value, HABITATS_MEMBER);
    yield vocabularyEvent(
      "habitat",
      code,
      HABITATS_MEMBER,
      row.recordNumber,
      row.record,
    );
  }
  for await (const row of readTaxrefMember(archive, {
    member: STATUSES_MEMBER,
    headers: STATUS_HEADERS,
    delimiter: ";",
    encoding: "windows-1252",
  })) {
    const code = vocabularyCode(
      row.record,
      "STATUT",
      STATUSES_MEMBER,
      row.recordNumber,
    );
    const value = { code, label: row.record.DESCRIPTION ?? "" };
    insertVocabulary(statuses, value, STATUSES_MEMBER);
    yield vocabularyEvent(
      "territory-status",
      code,
      STATUSES_MEMBER,
      row.recordNumber,
      row.record,
    );
  }
}

function vocabularyEvent(
  vocabulary: TaxrefVocabularyRecord["vocabulary"],
  code: string,
  member: string,
  recordNumber: number,
  rawRecord: TaxrefRawRecord,
): ImportEvent {
  return {
    output: "vocabularies",
    value: {
      vocabulary,
      code,
      sourceLocator: locator(member, recordNumber),
      recordNumber,
      rawRecord,
    },
  };
}

function territoryStatusValues(
  record: TaxrefRawRecord,
  recordNumber: number,
  statuses: ReadonlyMap<string, VocabularyValue>,
): TaxrefTerritoryStatus[] {
  const values: TaxrefTerritoryStatus[] = [];
  for (const territoryCode of TERRITORY_FIELDS) {
    const statusCode = record[territoryCode] ?? "";
    if (statusCode === "") continue;
    const vocabulary = statuses.get(statusCode);
    if (vocabulary === undefined) {
      throw new Error(
        `Unknown TAXREF territory status ${statusCode} in ${territoryCode} at record ${recordNumber}`,
      );
    }
    values.push({
      territoryCode,
      statusCode,
      statusLabel: vocabulary.label,
      sourceLocator: fieldLocator(TAXONOMY_MEMBER, recordNumber, territoryCode),
    });
  }
  return values;
}

function* validateTaxonGraph(
  index: ReadonlyMap<string, TaxrefTaxonIndexEntry>,
): Generator<TaxrefDiagnostic> {
  for (const [id, record] of index) {
    const reference = index.get(record.referenceIdentifier);
    if (reference === undefined) {
      throw new Error(
        `TAXREF CD_NOM ${id} references missing CD_REF ${record.referenceIdentifier}`,
      );
    }
    if (reference.referenceIdentifier !== record.referenceIdentifier) {
      throw new Error(
        `TAXREF CD_NOM ${id} has non-terminal CD_REF ${record.referenceIdentifier}`,
      );
    }
    for (const [field, parent] of [
      ["CD_SUP", record.parentIdentifier],
      ["CD_TAXSUP", record.simplifiedParentIdentifier],
    ] as const) {
      if (parent === "" || index.has(parent)) continue;
      yield diagnostic(
        "unresolved-mapping",
        "MISSING_PARENT_TARGET",
        `TAXREF ${field} points outside the distributed taxonomy table; parent closure remains unresolved.`,
        record.sourceLocator,
        { field, identifier: id, missingParentIdentifier: parent },
        undefined,
        id,
      );
    }
  }
  assertAcyclic(index, "CD_SUP", (entry) => entry.parentIdentifier);
  assertAcyclic(
    index,
    "CD_TAXSUP",
    (entry) => entry.simplifiedParentIdentifier,
  );
}

function assertAcyclic(
  index: ReadonlyMap<string, TaxrefTaxonIndexEntry>,
  field: string,
  edge: (entry: TaxrefTaxonIndexEntry) => string,
): void {
  const complete = new Set<string>();
  for (const start of index.keys()) {
    if (complete.has(start)) continue;
    const path: string[] = [];
    const positions = new Map<string, number>();
    let current = start;
    while (index.has(current) && !complete.has(current)) {
      const position = positions.get(current);
      if (position !== undefined) {
        const cycle = path.slice(position).concat(current);
        throw new Error(`TAXREF ${field} cycle: ${cycle.join(" -> ")}`);
      }
      positions.set(current, path.length);
      path.push(current);
      const next = edge(index.get(current)!);
      if (next === "") break;
      current = next;
    }
    for (const id of path) complete.add(id);
  }
}

function assertSourceManifest(value: unknown): void {
  const manifest = asRecord(value);
  const release = asRecord(manifest?.release);
  if (
    manifest?.id !== TAXREF_SOURCE_MANIFEST_ID ||
    release?.identifier !== TAXREF_RELEASE_ID
  ) {
    throw new Error("TAXREF source manifest identity or release changed");
  }
}

function output(name: string, schemaId: string) {
  return {
    name,
    path: `${name}.jsonl`,
    role: "auxiliary" as const,
    mediaType: "application/jsonl",
    schemaId,
  };
}

function locator(member: string, recordNumber: number): string {
  return `${TAXREF_ARCHIVE_LOCATOR}!/${member}#record=${recordNumber}`;
}

function fieldLocator(
  member: string,
  recordNumber: number,
  field: string,
): string {
  return `${locator(member, recordNumber)}&field=${field}`;
}

function requiredIdentifier(
  record: TaxrefRawRecord,
  field: string,
  member: string,
  recordNumber: number,
): string {
  const value = requiredValue(record, field, member, recordNumber);
  if (!/^[0-9]+$/u.test(value)) {
    throw new Error(
      `${member} record ${recordNumber} has invalid ${field} ${JSON.stringify(value)}`,
    );
  }
  return value;
}

function requiredValue(
  record: TaxrefRawRecord,
  field: string,
  member: string,
  recordNumber: number,
): string {
  const value = record[field] ?? "";
  if (value.length === 0) {
    throw new Error(`${member} record ${recordNumber} is missing ${field}`);
  }
  return value;
}

function vocabularyCode(
  record: TaxrefRawRecord,
  field: string,
  member: string,
  recordNumber: number,
): string {
  return requiredValue(record, field, member, recordNumber);
}

function insertVocabulary(
  target: Map<string, VocabularyValue>,
  value: VocabularyValue,
  member: string,
): void {
  if (target.has(value.code)) {
    throw new Error(`Duplicate vocabulary code ${value.code} in ${member}`);
  }
  target.set(value.code, value);
}

function diagnostic(
  kind: TaxrefDiagnostic["kind"],
  code: string,
  message: string,
  sourceLocator: string,
  details: Readonly<Record<string, unknown>>,
  sourceRecordKey?: TaxrefDiagnostic["sourceRecordKey"],
  sourceRecordId?: string,
): TaxrefDiagnostic {
  return {
    kind,
    code,
    message,
    sourceLocator,
    details,
    ...(sourceRecordKey === undefined ? {} : { sourceRecordKey }),
    ...(sourceRecordId === undefined ? {} : { sourceRecordId }),
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
