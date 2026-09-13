# GROW source package

The pinned upstream release is the University of Dundee Edible Plant Database, DOI `10.15132/10000157`,
published in May 2020. The University of Dundee dataset record declares CC BY 4.0. The original release
files and the derived CSV used by the importer are versioned in `releases/2020/`. The GROW adapter pins
their checksums in `source-manifest.json`.

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
