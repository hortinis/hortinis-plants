export const TAXREF_SOURCE_ID = "source_taxref";
export const TAXREF_SOURCE_MANIFEST_ID = "source_manifest_taxref_18_0";
export const TAXREF_RELEASE_ID = "18.0";
export const TAXREF_ARCHIVE_LOCATOR =
  "https://assets.patrinat.fr/files/referentiel/TAXREF_v18_2025.zip";
export const TAXREF_DECLARED_LICENCE =
  "Open Licence (TAXREF publisher terms; version unspecified)";
export const TAXREF_LICENCE_ID = "licence_taxref_open_licence";
export const TAXREF_CITATION =
  "TAXREF [Eds] 2025. TAXREF v18.0, référentiel taxonomique pour la France. PatriNat (OFB-CNRS-MNHN-IRD), Muséum national d’Histoire naturelle, Paris. Archive generated 9 January 2025. Adapted by Hortinis.";

export const TAXONOMY_MEMBER = "TAXREFv18.txt";
export const VERNACULAR_MEMBER = "TAXVERNv18.txt";
export const CHANGES_MEMBER = "TAXREF_CHANGES.txt";
export const REMOVED_MEMBER = "CDNOM_DISPARUS.txt";
export const RANKS_MEMBER = "rangs_note.csv";
export const HABITATS_MEMBER = "habitats_note.csv";
export const STATUSES_MEMBER = "statuts_note.csv";

export const TERRITORY_FIELDS = [
  "FR",
  "GF",
  "MAR",
  "GUA",
  "SM",
  "SB",
  "SPM",
  "MAY",
  "EPA",
  "REU",
  "SA",
  "TA",
  "TAAF",
  "PF",
  "NC",
  "WF",
  "CLI",
] as const;

export const TAXONOMY_HEADERS = [
  "REGNE",
  "PHYLUM",
  "CLASSE",
  "ORDRE",
  "FAMILLE",
  "SOUS_FAMILLE",
  "TRIBU",
  "GROUP1_INPN",
  "GROUP2_INPN",
  "GROUP3_INPN",
  "CD_NOM",
  "CD_TAXSUP",
  "CD_SUP",
  "CD_REF",
  "CD_BA",
  "RANG",
  "LB_NOM",
  "LB_AUTEUR",
  "NOMENCLATURAL_COMMENT",
  "NOM_COMPLET",
  "NOM_COMPLET_HTML",
  "NOM_VALIDE",
  "NOM_VERN",
  "NOM_VERN_ENG",
  "HABITAT",
  ...TERRITORY_FIELDS,
  "URL",
  "URL_INPN",
] as const;

export const VERNACULAR_HEADERS = [
  "CD_VERN",
  "CD_NOM",
  "LB_VERN",
  "NOM_VERN_SOURCE",
  "LANGUE",
  "ISO639_3",
  "PAYS",
] as const;

export const CHANGE_HEADERS = [
  "CD_NOM",
  "NUM_VERSION_INIT",
  "NUM_VERSION_FINAL",
  "CHAMP",
  "VALEUR_INIT",
  "VALEUR_FINAL",
  "TYPE_CHANGE",
] as const;

export const REMOVED_HEADERS = [
  "CD_NOM",
  "PLUS_RECENTE_DIFFUSION",
  "CD_NOM_REMPLACEMENT",
  "CD_RAISON_SUPPRESSION",
  "RAISON_SUPPRESSION",
] as const;

export const RANK_HEADERS = [
  "RG_LEVEL",
  "RANG",
  "DETAIL",
  "DETAIL_EN",
] as const;
export const HABITAT_HEADERS = ["HABITAT", "LB_HABITAT", "DEFINITION"] as const;
export const STATUS_HEADERS = [
  "ORDRE",
  "STATUT",
  "DESCRIPTION",
  "DEFINITION",
] as const;

export const IMPORT_DIAGNOSTIC_SCHEMA =
  "urn:hortinis:plants:schema:v1:import-diagnostic";
export const TAXREF_TAXONOMIC_RECORD_SCHEMA =
  "urn:hortinis:plants:schema:v1:taxref-taxonomic-record";
export const TAXREF_VERNACULAR_RECORD_SCHEMA =
  "urn:hortinis:plants:schema:v1:taxref-vernacular-record";
export const TAXREF_LOCALIZATION_CANDIDATE_SCHEMA =
  "urn:hortinis:plants:schema:v1:taxref-localization-candidate";
export const TAXREF_CHANGE_RECORD_SCHEMA =
  "urn:hortinis:plants:schema:v1:taxref-change-record";
export const TAXREF_REMOVED_IDENTIFIER_SCHEMA =
  "urn:hortinis:plants:schema:v1:taxref-removed-identifier";
export const TAXREF_VOCABULARY_RECORD_SCHEMA =
  "urn:hortinis:plants:schema:v1:taxref-vocabulary-record";
