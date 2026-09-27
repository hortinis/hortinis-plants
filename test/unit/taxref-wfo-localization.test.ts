import { describe, expect, it } from "vitest";
import {
  classifyTaxrefWfoCrosswalk,
  type ReviewedWfoCrosswalk,
  type TaxrefExternalLink,
  type TaxrefTaxonRecord,
} from "../../src/curation/taxref-wfo-localization.js";
import { getCompiledValidationApi } from "../support/compiled-validation-api.js";

const crosswalk: ReviewedWfoCrosswalk = {
  id: "crosswalk_fixture",
  taxonId: "taxon_fixture",
  externalIdentifier: {
    sourceId: "source_world_flora_online_plant_list",
    sourceManifestId: "source_manifest_wfo_plant_list_2026_06",
    sourceReleaseId: "2026-06",
    identifier: "wfo-fixture",
  },
  externalName: "Solanum fixture",
  taxonRank: "species",
  taxonomicStatus: "Accepted",
  locator: "classification.csv#taxonID=wfo-fixture",
  reviewId: "review_fixture",
};

function link(taxrefIdentifier: string): TaxrefExternalLink {
  return {
    sourceLocator: `TAXREF_LIENS.txt#record=${taxrefIdentifier}`,
    recordNumber: Number(taxrefIdentifier),
    sourceAcronym: "WFO (World Flora Online)",
    sourceType: "CSD",
    sourceAuthors: "",
    sourceTitle: "World Flora Online",
    sourceUrl: "https://www.worldfloraonline.org",
    taxrefIdentifier,
    externalIdentifier: "wfo-fixture",
    externalUrl: `https://www.worldfloraonline.org/taxon/${taxrefIdentifier}`,
  };
}

function taxrefRecord(
  identifier: string,
  acceptedTaxonIdentifier = identifier,
  rank = "species",
  name = "Solanum fixture",
): TaxrefTaxonRecord {
  return {
    sourceRecordKey: { recordId: identifier },
    sourceLocator: `TAXREFv18.txt#record=${identifier}`,
    taxonomicStatus: "accepted",
    acceptedTaxonIdentifier,
    rank: { labelEnglish: rank, label: rank },
    rawRecord: { LB_NOM: name, NOM_VALIDE: name },
  };
}

describe("TAXREF localization to reviewed WFO identity", () => {
  it("links one exact TAXREF concept and preserves evidence", async () => {
    const result = classifyTaxrefWfoCrosswalk(
      crosswalk,
      [link("100")],
      new Map([["100", taxrefRecord("100")]]),
    );
    expect(result.outcome).toMatchObject({
      outcome: "linked",
      candidateTaxrefIdentifiers: ["100"],
      reviewState: "unreviewed",
    });
    expect(result.outcome.evidence).toMatchObject([
      { kind: "taxref-external-link", taxrefIdentifier: "100" },
    ]);
    const api = await getCompiledValidationApi();
    expect(
      api.validate(
        "urn:hortinis:plants:schema:curation:v1:taxref-wfo-link-outcome",
        result.outcome,
      ),
    ).toEqual({ valid: true });
  });

  it("keeps multiple TAXREF concepts ambiguous", () => {
    const result = classifyTaxrefWfoCrosswalk(
      crosswalk,
      [link("100"), link("101")],
      new Map([
        ["100", taxrefRecord("100")],
        ["101", taxrefRecord("101")],
      ]),
    );
    expect(result.outcome.outcome).toBe("ambiguous");
    expect(result.canonicalTaxrefIdentifiers).toEqual([]);
  });

  it("surfaces rank or name disagreement as a visible outcome", () => {
    const result = classifyTaxrefWfoCrosswalk(
      crosswalk,
      [link("100")],
      new Map([["100", taxrefRecord("100", "100", "genus")]]),
    );
    expect(result.outcome.outcome).toBe("concept-disagreement");
    expect(result.diagnostics.map((item) => item.code)).toContain(
      "TAXREF_WFO_CONCEPT_DISAGREEMENT",
    );
  });

  it("does not treat missing TAXREF links as a WFO identity failure", () => {
    const result = classifyTaxrefWfoCrosswalk(crosswalk, [], new Map());
    expect(result.outcome.outcome).toBe("not-found");
    expect(result.outcome.taxonId).toBe("taxon_fixture");
  });
});
