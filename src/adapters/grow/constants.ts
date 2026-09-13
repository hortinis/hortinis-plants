export const GROW_SOURCE_ID = "source_grow_edible_plant_database";
export const GROW_SOURCE_MANIFEST_ID = "source_manifest_grow_epd_2020";
export const GROW_SOURCE_RELEASE_ID = "doi:10.15132/10000157";
export const GROW_LICENCE_ID = "licence_cc_by_4_0";
export const GROW_LICENCE_EXPRESSION = "CC-BY-4.0";
export const GROW_PUBLISHER = "University of Dundee";

export const EXPECTED_PACKAGE_RESOURCES = [
  {
    path: "plant1.accdb",
    sha256: "9a4a5262e1584529030e9cdc95edaf7528959a825a3ee54053cb3d8778b23860",
    mediaType: "application/x-msaccess",
    role: "upstream",
  },
  {
    path: "PlantingCalendar.xlsx",
    sha256: "f373169ae093f795820eb1827fa52103cfc51fb444cc118f2b7a0e262b82cd63",
    mediaType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    role: "upstream",
  },
  {
    path: "Edible_Plant_Database.docx",
    sha256: "f7f6bf68cec8fe441c83ed29bfe24cad4d2d30ce27415ce6a0a03ffb5a5a872f",
    mediaType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    role: "upstream",
  },
  {
    path: "ReadMe.md",
    sha256: "45995cd3a062821e191c562d61d9a2a2aac710e6cc8f6de724cd172de8c5a2a7",
    mediaType: "text/markdown",
    role: "upstream",
  },
  {
    path: "export/edible-plants.csv",
    sha256: "424212df13d9e21922a373701bb6ea8b0b70564789b27d24fb7f9ef1689f79d3",
    mediaType: "text/csv",
    role: "derived",
  },
] as const;

export const EXPECTED_PLANT_FIELDS = [
  "ID",
  "Full taxonomic name",
  "Common name",
  "Cultivation group (Rotational information)",
  "Sunlight requirements",
  "Temperature class",
  "Nutrient requirements",
  "Preferred pH",
  "Nutritional information",
  "Energy Value per 100g raw Kcal",
  "General Description",
  "Sensitivities",
  "Water Requirements",
  "Plant Requirements",
  "Descriptive Growing Season",
  "Pests and Pathogens",
  "Disease Management",
  "Soil",
  "Optimum Germination Temerature",
  "Days to germination at optimum temperature",
  "Plant growing ideal temperature",
  "Length of gorwing to harvest",
  "Image_product",
  "image_plant",
] as const;

export const EXPECTED_LOCATION_SHEETS = [
  "MDS",
  "MDM",
  "LUS",
  "ALN",
  "BOR",
  "NEM",
  "ATN",
  "ALS",
  "CON",
  "MDN",
  "PAN",
  "ATC",
] as const;

export const EXPECTED_MISSING_PLANT_IDS = [6, 12, 18, 41, 61, 91] as const;
