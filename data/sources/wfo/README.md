# World Flora Online Plant List 2026-06

Pinned release: [World Flora Online Plant List, June 2026](https://zenodo.org/records/20782718),
released 2026-06-22. The importer reads `_DwC_backbone_R.zip`, specifically its
`classification.csv` member; it does not call the WFO API.

Expected archive: [download `_DwC_backbone_R.zip` from Zenodo](https://zenodo.org/records/20782718/files/_DwC_backbone_R.zip?download=1).

The archive is intentionally kept outside Git at
`.cache/source-inputs/wfo/2026-06/_DwC_backbone_R.zip`. Download and verify it from the repository
root:

```sh
mkdir -p .cache/source-inputs/wfo/2026-06
curl --fail --location --output .cache/source-inputs/wfo/2026-06/_DwC_backbone_R.zip \
  'https://zenodo.org/records/20782718/files/_DwC_backbone_R.zip?download=1'
test "$(wc -c < .cache/source-inputs/wfo/2026-06/_DwC_backbone_R.zip)" -eq 121660019
printf '%s  %s\n' \
  '0e4486945cd9f7af548ca87eb9a870ed' \
  '.cache/source-inputs/wfo/2026-06/_DwC_backbone_R.zip' | md5sum --check
```

These values are also enforced against `source-manifest.json` by `pnpm import:wfo`. The run manifest
records SHA-256 for the local snapshot in addition to checking the publisher's declared MD5 and exact
byte size. Do not replace this archive with another WFO edition.

WFO's [download page](https://www.worldfloraonline.org/downloadData) declares the static Taxonomic
Backbone data CC0 1.0 Universal. The release manifest records this license review and cites that
primary evidence. WFO web-page text and images are not imported.
