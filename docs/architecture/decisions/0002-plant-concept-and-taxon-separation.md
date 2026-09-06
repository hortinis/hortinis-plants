# ADR-0002: Separate plant concepts from taxa

- Status: validated

## Decision

Taxonomy supplies scientific identity and relationships. `PlantConcept` supplies cultivated meaning and stable catalog identity. Cultivars and cultivar groups are optional children.

## Consequences

Taxonomic name changes do not rewrite garden history. Plant concepts retain aliases and replacements; later linking a free-form user entry must preserve its historical label.
