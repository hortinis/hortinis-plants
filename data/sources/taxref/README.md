# TAXREF source package

## Pinned release

This package pins TAXREF v18.0, published 9 January 2025. The source is the full archive `TAXREF_v18_2025.zip`, downloaded from the temporary PatriNat release link. Its exact size and SHA-256 are recorded in `source-manifest.json`. The archive is intentionally kept outside Git at `.cache/source-inputs/taxref/18.0/TAXREF_v18_2025.zip`.

The archive contains nine root-level files. `archive-index.json` records the exact names, uncompressed byte sizes and SHA-256 of every member. Run the preflight from the repository root:

```sh
pnpm verify:taxref-pin
```

The check verifies the archive before opening it, then streams and verifies every member. Missing, duplicate, unexpected or changed members fail with a path-specific diagnostic. No member is parsed or written to an output directory by this check.

## File contract observed in the pinned bytes

The tab-delimited text tables use UTF-8 and CRLF line endings. Fields use double quotes where quoted; numeric fields may be unquoted. The three small code lists use Windows-1252, semicolon delimiters and CRLF. Keep the original strings, decode each member using its recorded encoding, and do not rely on a single archive-wide decoder in T12.

| Member | Role and relevant fields |
| --- | --- |
| `TAXREFv18.txt` | Taxonomic records. Header includes `CD_NOM`, `CD_REF`, `CD_SUP`, `RANG`, `LB_NOM`, `LB_AUTEUR`, `NOM_COMPLET`, `NOM_VALIDE`, `NOM_VERN`, `NOM_VERN_ENG`, `FR`, `GF`, `MAR`, `GUA`, `SM`, `SB`, `SPM`, `MAY`, `EPA`, `REU`, `SA`, `TA`, `TAAF`, `PF`, `NC`, `WF`, `CLI`, `URL` and `URL_INPN`. |
| `TAXVERNv18.txt` | Vernacular rows. Header includes `CD_VERN`, `CD_NOM`, `LB_VERN`, `NOM_VERN_SOURCE`, `LANGUE`, `ISO639_3` and `PAYS`. The methodology says the vernacular field may contain comma-separated names; preserve the original string and do not treat a delimiter split as reviewed names. |
| `TAXREF_CHANGES.txt` | Changes between releases, keyed by `CD_NOM`, with initial/final versions, field, values and change type. |
| `TAXREF_LIENS.txt` | Links to external source databases, with source acronym/type/authors/title/URL and the TAXREF and external identifiers. |
| `CDNOM_DISPARUS.txt` | Removed identifiers, possible replacement `CD_NOM`, reason code and reason text. |
| `rangs_note.csv` | Rank code list: `RANG_LEVEL`, `RANG`, `DETAIL`, `DETAIL_EN`. |
| `habitats_note.csv` | Habitat code list for the taxonomy table's `HABITAT` values. |
| `statuts_note.csv` | Territory status vocabulary used by territory columns such as `FR`, `GF`, `MAR`, `GUA`, `REU`, `PF` and `NC`. |
| `TAXREFv18.pdf` | Release methodology and documentation. The PDF is part of the pin, even though its table descriptions may not match every v18 archive header; the archive headers above are transcribed from the actual v18 bytes. |

The current package is a full national and overseas-territory release, not a filtered taxonomic or geographic extract. TAXREF supplies French localization and territory/status evidence alongside WFO review; it does not replace WFO as the catalog identity backbone.

## Citation and rights

Publisher citation: TAXREF [Eds] 2025. *TAXREF v18.0, référentiel taxonomique pour la France*. PatriNat (OFB-CNRS-MNHN-IRD), Muséum national d’Histoire naturelle, Paris. Archive generated 9 January 2025.

TAXREF's [conditions of use](https://taxref.mnhn.fr/taxref-web/about) say its data are available under the Open Licence, equivalent to CC-BY, with unrestricted reuse subject to citation; redistribution is permitted. The publisher's page does not name a numbered licence version, so the source metadata records the generic Open Licence declaration without guessing a CC-BY version. Commercial reuse of the TAXREF data is eligible with the required attribution. This decision does not cover separately reused third-party publications, images, or website content.

The temporary PatriNat download may be withdrawn after INPN service is restored. The exact bytes remain locally verifiable by checksum; future release upgrades require a new source release pin and review.
