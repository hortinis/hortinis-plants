# GROW source package

The pinned upstream release is the University of Dundee Edible Plant Database, DOI `10.15132/10000157`,
published in May 2020. The University of Dundee dataset record declares CC BY 4.0. The original release
files and the derived CSV used by the importer are versioned in `releases/2020/`. The GROW adapter pins
their checksums in `source-manifest.json`.

Upstream record and download links:

- [University of Dundee dataset record](https://discovery.dundee.ac.uk/en/datasets/edible-plant-database/)
- [`plant1.accdb`](https://discovery.dundee.ac.uk/files/49103345/plant1.accdb)
- [`PlantingCalendar.xlsx`](https://discovery.dundee.ac.uk/files/49103344/PlantingCalendar.xlsx)
- [`Edible_Plant_Database.docx`](https://discovery.dundee.ac.uk/files/49103343/Edible_Plant_Database.docx)
- [Published readme (`HowtoView_1_.txt`; stored here as `ReadMe.md`)](https://discovery.dundee.ac.uk/files/49103342/HowtoView_1_.txt)

The publisher exposes these as individual files rather than one archive. These are the expected
upstream downloads corresponding to the pinned resources in `source-manifest.json`; the importer uses
the checked-in release files and does not download them at runtime.

`releases/2020/export/edible-plants.csv` is derived from the Access database. It was created with mdbtools v1.0.1 using:

```sh
mdb-export plant1.accdb 'Edible plants' > export/edible-plants.csv
```

The adapter verifies the CSV checksum as well as the four upstream resources. If the CSV is recreated
with a different mdbtools version, review the export difference and update its recorded preparation
provenance deliberately. Do not update the expected checksum to silence a mismatch.

GROW plant IDs are preserved as source record identifiers. Image columns are retained in the local
lossless extraction for provenance but excluded from normalized candidates and release output because
the source documentation says the images were separately licensed.
