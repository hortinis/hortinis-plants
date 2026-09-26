import type {
  QualifiedSourceRecordKey,
  SemanticSubrecordKey,
} from "../../domain/source-keys.js";

export type SourceAction =
  "start_indoors" | "direct_sow" | "transplant" | "plant_now";
export interface CropGraphWindow {
  readonly action: SourceAction;
  readonly anchor: "last_spring" | "first_fall";
  readonly fromFrostDays: number;
  readonly toFrostDays: number;
  readonly notes?: string;
}
export interface CropGraphEntry {
  readonly slug: string;
  readonly commonName: string;
  readonly scientificName: string;
  readonly category: string;
  readonly season: string;
  readonly growingContext?: "outdoor" | "indoor" | "both" | "greenhouse";
  readonly daysToHarvest: { readonly min: number; readonly max: number };
  readonly minSoilTempF?: number | null;
  readonly zoneRange: { readonly min: number; readonly max: number };
  readonly windows: readonly CropGraphWindow[];
  readonly notes?: string;
  readonly aliases?: readonly string[];
  readonly source?: string;
  readonly climateModifiers?: Readonly<
    Record<
      string,
      {
        readonly windowShifts?: Partial<Readonly<Record<SourceAction, number>>>;
        readonly notes?: string;
      }
    >
  >;
}
export interface CropGraphRawRecord {
  readonly sourceRecordKey: QualifiedSourceRecordKey;
  readonly sourceLocator: string;
  readonly originalIndex: number;
  readonly rawEntry: CropGraphEntry;
  readonly effectiveCitation: string;
  readonly citationLevel: "entry" | "calendar";
  readonly declaredLicence: "CC-BY-4.0";
  readonly commercialRights: "pending-review";
}
export type IdentityKind =
  "scientific-name" | "common-name" | "alias" | "subject-label";
export type CultivationKind =
  | "window"
  | "context"
  | "soil-temperature"
  | "harvest-range"
  | "classification"
  | "modifier"
  | "note";
export interface CropGraphCandidate<
  K extends IdentityKind | CultivationKind = IdentityKind | CultivationKind,
> {
  readonly id: string;
  readonly kind: K;
  readonly sourceRecordKey: QualifiedSourceRecordKey;
  readonly sourceClaimKey: SemanticSubrecordKey;
  readonly sourceLocators: string[];
  readonly rawValue: unknown;
  readonly value: Readonly<Record<string, unknown>>;
  readonly mappingMethod:
    "source-preserved" | "explicit-label" | "normalized-source-timing";
  readonly relatedCandidateIds: string[];
  readonly reviewState: "unreviewed";
  readonly effectiveCitation: string;
  readonly citationLevel: "entry" | "calendar";
  readonly citationLocator: string;
  readonly licenceId: "licence_cropgraph_data_declared_cc_by_4_0";
  readonly declaredLicence: "CC-BY-4.0";
  readonly commercialRights: "pending-review";
}
export interface CropGraphDiagnostic {
  readonly kind: "warning" | "unresolved-mapping";
  readonly code: string;
  readonly message: string;
  readonly sourceRecordKey: QualifiedSourceRecordKey;
  readonly sourceLocator: string;
  readonly details: Readonly<Record<string, unknown>>;
}
