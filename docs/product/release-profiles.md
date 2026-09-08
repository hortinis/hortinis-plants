# Release profiles

The compiler produces named profiles so the MVP can exclude unnecessary size and rights complexity.

| Profile        | Purpose                    | Content                                                                                                                                                                                                       |
| -------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fr-mvp`       | First Hortinis release     | The 33 reviewed generic plant concepts from ADR-0005; two tomato cultivar exemplars; French and English names; identity, cold sensitivity and planting-window rules for metropolitan France including Corsica |
| `fr-rich`      | Expanded France use        | Additional cultivation, threats and reviewed regional rules                                                                                                                                                   |
| `global-core`  | Reusable reference layer   | Global taxonomy, synonyms and generally reusable traits                                                                                                                                                       |
| optional packs | Explicit opt-in extensions | Regional, image or specialist content with independent licence manifests                                                                                                                                      |

Every profile has its own manifest and attribution output. Consumers must not assume records exist across profiles.

`fr-mvp` does not require broad cultivar coverage. A missing localized name falls back deterministically to another explicitly tagged name and then to the scientific name; it does not authorize an invented translation.
