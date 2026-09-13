export type GrowRawValue = string | number | boolean | null;

export interface GrowPlantRecord {
  readonly sourceRecordId: string;
  readonly sourceLocator: string;
  readonly fields: Readonly<Record<string, GrowRawValue>>;
}

export interface MonthDay {
  readonly month: number;
  readonly day: number;
}

export interface TemperatureProfile {
  readonly unit: "Cel";
  readonly minimum?: number;
  readonly maximum?: number;
  readonly optimum?: number;
}

export interface DurationRange {
  readonly unit: "d";
  readonly minimum?: number;
  readonly maximum?: number;
}

export interface GrowLocation {
  readonly sheetCode: string;
  readonly name: string;
  readonly country: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly strataCodes: readonly string[];
}

export interface GrowCalendarWindow {
  readonly sourceRecordId: string;
  readonly sourceLocator: string;
  readonly sourceName: string;
  readonly sourceCommonName: string;
  readonly location: GrowLocation;
  readonly season: 1 | 2;
  readonly operation:
    "indoors_or_undercover" | "outdoor_sowing_or_planting" | "harvest";
  readonly start: MonthDay;
  readonly end: MonthDay;
  readonly precision: "day";
  readonly crossesYearBoundary: boolean;
}

export interface GrowCandidate {
  readonly id: string;
  readonly sourceId: string;
  readonly sourceManifestId: string;
  readonly sourceReleaseId: string;
  readonly sourceRecordId: string;
  readonly sourceLocator: string;
  readonly licenceId: string;
  readonly licenceDecision: "eligible";
  readonly predicate: string;
  readonly rawValue: unknown;
  readonly normalizedValue: unknown;
  readonly applicability: Readonly<Record<string, unknown>>;
  readonly reviewStatus: "unreviewed";
}

export interface GrowDiagnostic {
  readonly code: string;
  readonly severity: "info" | "warning" | "error";
  readonly message: string;
  readonly sourceRecordId?: string;
  readonly sourceLocator?: string;
  readonly field?: string;
  readonly originalValue?: unknown;
}

export interface GrowExtraction {
  readonly plants: readonly GrowPlantRecord[];
  readonly locations: readonly GrowLocation[];
  readonly calendarWindows: readonly GrowCalendarWindow[];
  readonly candidates: readonly GrowCandidate[];
  readonly diagnostics: readonly GrowDiagnostic[];
}

export interface GrowSourceResource {
  readonly path: string;
  readonly sha256: string;
  readonly mediaType: string;
  readonly role: "upstream" | "derived";
}

export interface GrowImportSummary {
  readonly sourceManifestId: string;
  readonly sourceReleaseId: string;
  readonly inputDirectory: string;
  readonly outputDirectory: string;
  readonly resources: readonly GrowSourceResource[];
  readonly counts: Readonly<Record<string, number>>;
  readonly diagnosticCounts: Readonly<Record<string, number>>;
}
