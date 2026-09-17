export interface WfoSnapshotRecord {
  readonly taxonID: string;
  readonly scientificName: string;
  readonly scientificNameAuthorship: string;
  readonly taxonRank: string;
  readonly taxonomicStatus: string;
  readonly acceptedNameUsageID: string;
  readonly parentNameUsageID: string;
  readonly genus: string;
  readonly family: string;
  readonly rowNumber: number;
}

export interface SourceRecordKey {
  readonly source: {
    readonly sourceId: string;
    readonly sourceManifestId: string;
    readonly sourceReleaseId: string;
  };
  readonly recordId: string;
}

export type GrowNameRecord =
  | {
      readonly sourceRecordKey: SourceRecordKey;
      readonly sourceRecordId?: string;
      readonly sourceLocator: string;
      readonly scientificName: string;
    }
  | {
      readonly sourceRecordId: string;
      readonly sourceRecordKey?: SourceRecordKey;
      readonly sourceLocator: string;
      readonly scientificName: string;
    };
export type TaxonMatchOutcome =
  | "candidate-accepted"
  | "candidate-synonym"
  | "ambiguous"
  | "unplaced"
  | "unresolved-status"
  | "unmatched";

export type WfoStatusCategory = "accepted" | "synonym" | "unplaced" | "other";

export interface WfoTaxonMatchAlternative {
  readonly externalIdentifier: {
    readonly sourceId: string;
    readonly sourceManifestId: string;
    readonly sourceReleaseId: string;
    readonly identifier: string;
  };
  readonly scientificName: string;
  readonly authorship?: string;
  readonly taxonRank: string;
  readonly taxonomicStatus: string;
  readonly statusCategory: WfoStatusCategory;
  readonly acceptedNameIdentifier?: string;
  readonly acceptedName?: {
    readonly externalIdentifier: {
      readonly sourceId: string;
      readonly sourceManifestId: string;
      readonly sourceReleaseId: string;
      readonly identifier: string;
    };
    readonly scientificName: string;
    readonly authorship?: string;
    readonly taxonRank: string;
    readonly taxonomicStatus: string;
    readonly sourceLocator: string;
  };
  readonly sourceLocator: string;
}

export interface TaxonMatchCandidate {
  readonly id: string;
  readonly source: {
    readonly sourceRecordKey: SourceRecordKey;
    readonly sourceRecordId?: string;
    readonly sourceLocator: string;
  };
  readonly snapshot: {
    readonly sourceManifestId: string;
    readonly sourceReleaseId: string;
    readonly sha256: string;
  };
  readonly sourceName: string;
  readonly comparisonName: string;
  readonly normalization: "unicode-nfc-trim-collapse-whitespace-v1";
  readonly outcome: TaxonMatchOutcome;
  readonly alternatives: readonly WfoTaxonMatchAlternative[];
  readonly matchMethod?: "exact-conservative-normalization-v1";
  readonly reviewState: "unreviewed";
}

export interface WfoTaxonomicOutputRecord {
  readonly externalIdentifier: {
    readonly sourceId: string;
    readonly sourceManifestId: string;
    readonly sourceReleaseId: string;
    readonly identifier: string;
  };
  readonly scientificName: string;
  readonly authorship?: string;
  readonly taxonRank: string;
  readonly taxonomicStatus: string;
  readonly acceptedNameUsageId?: string;
  readonly parentNameUsageId?: string;
  readonly genus?: string;
  readonly family?: string;
  readonly sourceLocator: string;
  readonly selectionReasons: readonly (
    | "source-name-match"
    | "accepted-name-target"
    | "synonym-of-selected-taxon"
    | "genus-ancestor"
    | "family-ancestor"
  )[];
}

export interface GrowImportRecord {
  readonly sourceRecordKey: SourceRecordKey;
  readonly sourceLocator: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

export interface WfoDiagnostic {
  readonly kind: "warning" | "rejected-record" | "unresolved-mapping";
  readonly code: string;
  readonly message: string;
  readonly sourceRecordId?: string;
  readonly sourceRecordKey?: SourceRecordKey;
  readonly sourceLocator?: string;
  readonly originalValue?: unknown;
  readonly details?: Readonly<Record<string, unknown>>;
}
