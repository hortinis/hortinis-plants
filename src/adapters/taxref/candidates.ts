import { createHash } from "node:crypto";
import {
  makeSemanticSubrecordKey,
  serializeSemanticSubrecordKey,
  type QualifiedSourceRecordKey,
} from "../../domain/source-keys.js";
import { serializeCanonicalJson } from "../../serialization/canonical-json.js";
import {
  TAXREF_CITATION,
  TAXREF_DECLARED_LICENCE,
  TAXREF_LICENCE_ID,
} from "./constants.js";
import type {
  TaxrefLocalizationCandidate,
  TaxrefTerritoryStatus,
} from "./types.js";

export function makeTaxrefLocalizationCandidate(options: {
  readonly sourceRecordKey: QualifiedSourceRecordKey;
  readonly targetTaxonRecordKey: QualifiedSourceRecordKey;
  readonly acceptedTaxonIdentifier: string;
  readonly sourceLocator: string;
  readonly citationLocator: string;
  readonly field: "LB_VERN" | "NOM_VERN";
  readonly text: string;
  readonly sourceLanguage: string;
  readonly languageVerification:
    "taxref-french-field-contract" | "taxref-iso639-3-and-label";
  readonly country?: string;
  readonly territoryStatuses: readonly TaxrefTerritoryStatus[];
}): TaxrefLocalizationCandidate {
  const taxonomicStatus =
    options.targetTaxonRecordKey.recordId === options.acceptedTaxonIdentifier
      ? "accepted"
      : "synonym";
  const value = {
    text: options.text,
    languageTag: "fr" as const,
    sourceLanguage: options.sourceLanguage,
    sourceLanguageCode: "fra" as const,
    languageVerification: options.languageVerification,
    ...(options.country === undefined || options.country.length === 0
      ? {}
      : { nameUsageTerritoryOriginal: options.country }),
    taxonBiogeographicStatuses: options.territoryStatuses,
    delimiterInterpretation: "preserved-unsplit" as const,
  };
  const sourceClaimKey = makeSemanticSubrecordKey(options.sourceRecordKey, [
    { kind: "field", id: options.field },
    {
      kind: "claim",
      id: digest({
        targetTaxonRecordKey: options.targetTaxonRecordKey,
        acceptedTaxonIdentifier: options.acceptedTaxonIdentifier,
        value,
      }),
    },
  ]);
  return {
    id: `candidate_${digest(serializeSemanticSubrecordKey(sourceClaimKey))}`,
    kind: "common-name",
    sourceRecordKey: options.sourceRecordKey,
    sourceClaimKey,
    targetTaxonRecordKey: options.targetTaxonRecordKey,
    acceptedTaxonIdentifier: options.acceptedTaxonIdentifier,
    taxonomicStatus,
    sourceLocators: [
      options.sourceLocator,
      ...options.territoryStatuses.map((status) => status.sourceLocator),
    ],
    rawValue: options.text,
    value,
    mappingMethod: "verified-source-language",
    reviewState: "unreviewed",
    effectiveCitation: TAXREF_CITATION,
    citationLocator: options.citationLocator,
    licenceId: TAXREF_LICENCE_ID,
    declaredLicence: TAXREF_DECLARED_LICENCE,
    commercialRights: "eligible",
  };
}

function digest(value: unknown): string {
  const bytes =
    typeof value === "string" ? value : serializeCanonicalJson(value);
  return createHash("sha256").update(bytes).digest("hex");
}
