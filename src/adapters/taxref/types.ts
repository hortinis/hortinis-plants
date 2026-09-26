import type {
  QualifiedSourceRecordKey,
  SemanticSubrecordKey,
} from "../../domain/source-keys.js";

export type TaxrefRawRecord = Readonly<Record<string, string>>;

export interface TaxrefTerritoryStatus {
  readonly territoryCode: string;
  readonly statusCode: string;
  readonly statusLabel: string;
  readonly sourceLocator: string;
}

export interface TaxrefTaxonomicRecord {
  readonly sourceRecordKey: QualifiedSourceRecordKey;
  readonly sourceLocator: string;
  readonly recordNumber: number;
  readonly taxonomicStatus: "accepted" | "synonym";
  readonly acceptedTaxonIdentifier: string;
  readonly rank: {
    readonly code: string;
    readonly level: string;
    readonly label: string;
    readonly labelEnglish: string;
  };
  readonly territoryStatuses: readonly TaxrefTerritoryStatus[];
  readonly rawRecord: TaxrefRawRecord;
}

export interface TaxrefVernacularRecord {
  readonly sourceRecordKey: QualifiedSourceRecordKey;
  readonly sourceLocator: string;
  readonly recordNumber: number;
  readonly targetTaxonIdentifier: string;
  readonly rawRecord: TaxrefRawRecord;
}

export interface TaxrefLocalizationCandidate {
  readonly id: string;
  readonly kind: "common-name";
  readonly sourceRecordKey: QualifiedSourceRecordKey;
  readonly sourceClaimKey: SemanticSubrecordKey;
  readonly targetTaxonRecordKey: QualifiedSourceRecordKey;
  readonly acceptedTaxonIdentifier: string;
  readonly taxonomicStatus: "accepted" | "synonym";
  readonly sourceLocators: readonly string[];
  readonly rawValue: string;
  readonly value: {
    readonly text: string;
    readonly languageTag: "fr";
    readonly sourceLanguage: string;
    readonly sourceLanguageCode: "fra";
    readonly languageVerification:
      "taxref-french-field-contract" | "taxref-iso639-3-and-label";
    readonly nameUsageTerritoryOriginal?: string;
    readonly taxonBiogeographicStatuses: readonly TaxrefTerritoryStatus[];
    readonly delimiterInterpretation: "preserved-unsplit";
  };
  readonly mappingMethod: "verified-source-language";
  readonly reviewState: "unreviewed";
  readonly effectiveCitation: string;
  readonly citationLocator: string;
  readonly licenceId: string;
  readonly declaredLicence: string;
  readonly commercialRights: "eligible";
}

export interface TaxrefDiagnostic {
  readonly kind: "warning" | "unresolved-mapping";
  readonly code: string;
  readonly message: string;
  readonly sourceRecordKey?: QualifiedSourceRecordKey;
  readonly sourceRecordId?: string;
  readonly sourceLocator: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface TaxrefVocabularyRecord {
  readonly vocabulary: "rank" | "habitat" | "territory-status";
  readonly code: string;
  readonly sourceLocator: string;
  readonly recordNumber: number;
  readonly rawRecord: TaxrefRawRecord;
}

export interface TaxrefTaxonIndexEntry {
  readonly referenceIdentifier: string;
  readonly parentIdentifier: string;
  readonly simplifiedParentIdentifier: string;
  readonly sourceLocator: string;
}

export interface PendingFrenchVernacular {
  readonly sourceRecordKey: QualifiedSourceRecordKey;
  readonly sourceLocator: string;
  readonly text: string;
  readonly country: string;
  readonly sourceLanguage: string;
}
