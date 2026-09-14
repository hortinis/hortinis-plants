export const WFO_SOURCE_ID = "source_world_flora_online_plant_list";
export const WFO_PROVIDER_ID = "provider_world_flora_online";
export const WFO_SOURCE_MANIFEST_ID = "source_manifest_wfo_plant_list_2026_06";
export const WFO_SOURCE_RELEASE_ID = "2026-06";
export const WFO_SNAPSHOT_FILENAME = "_DwC_backbone_R.zip";
export const WFO_CLASSIFICATION_FILENAME = "classification.csv";
export const WFO_RELEASE_RECORD_LOCATOR = "https://zenodo.org/records/20782718";
export const WFO_ARCHIVE_LOCATOR =
  "https://zenodo.org/records/20782718/files/_DwC_backbone_R.zip";
export const WFO_ARCHIVE_MD5 = "0e4486945cd9f7af548ca87eb9a870ed";
export const WFO_ARCHIVE_BYTE_SIZE = 121660019;
export const GROW_SOURCE_ID = "source_grow_edible_plant_database";
export const GROW_PROVIDER_ID = "provider_university_dundee";
export const GROW_SOURCE_MANIFEST_ID = "source_manifest_grow_epd_2020";
export const GROW_SOURCE_RELEASE_ID = "doi:10.15132/10000157";
export const NAME_NORMALIZATION_ID = "unicode-nfc-trim-collapse-whitespace-v1";
export const MATCH_METHOD = "exact-conservative-normalization-v1";

export const REQUIRED_WFO_COLUMNS = [
  "taxonID",
  "scientificName",
  "taxonRank",
  "taxonomicStatus",
  "acceptedNameUsageID",
  "parentNameUsageID",
  "scientificNameAuthorship",
  "genus",
  "family",
] as const;

export const TAXON_MATCH_CANDIDATE_SCHEMA =
  "urn:hortinis:plants:schema:v1:taxon-match-candidate";
export const WFO_TAXONOMIC_RECORD_SCHEMA =
  "urn:hortinis:plants:schema:v1:wfo-taxonomic-record";
export const IMPORT_DIAGNOSTIC_SCHEMA =
  "urn:hortinis:plants:schema:v1:import-diagnostic";
export const RECONCILIATION_MANIFEST_SCHEMA =
  "urn:hortinis:plants:schema:v1:taxonomy-reconciliation-manifest";
export const SOURCE_MANIFEST_SCHEMA =
  "urn:hortinis:plants:schema:v1:source-manifest";
