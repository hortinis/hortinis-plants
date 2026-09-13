# Catalog model

## Core concepts

`Taxon` carries botanical identity. `PlantConcept` is the Hortinis-facing cultivated subject and may
reference a taxon when that mapping is supported. `CultivarGroup` and `Cultivar` are optional children of a
plant concept. A localized name is a separate, evidence-backed record. Plant facts, cultivation rules,
contexts and relationships are also separate records joined by stable IDs.

An authoring assertion records one source-backed statement. A consumer projection emits normalized
`plant-fact` and `cultivation-rule` records only after review and profile-rights gates. Schemas define the
record boundaries; semantic build checks resolve references and enforce inheritance and release policy.

## Identifier rules

Identifiers are stable opaque strings minted by the catalog. Scientific names, aliases, file paths and
array positions are not identifiers. Retired records remain resolvable and identify a replacement when
one is known. A missing replacement is not guessed.

User records may retain a free-form historical label when no catalog entry exists. Linking a catalog ID
later must not rewrite that label.

## Cultivars and inheritance

A generic plant concept remains selectable without a cultivar. A cultivar references exactly one parent
plant concept and may have zero or more cultivar groups. When a cultivar is selected, Hortinis applies the
parent's accepted, profile-eligible facts and rules automatically, then includes the cultivar-scoped data.
The parent data is replaced only when a cultivar record explicitly lists the parent record in its matching
`supersedesFactIds`, `supersedesRuleIds` or other corresponding supersession field. Without that explicit
link, both records remain available; they are not merged into an invented value. A generic plant selection
does not receive cultivar-specific data.

Supersession is checked against subject ancestry and is explicit per record, not inferred from matching
predicates or timing. Consumers retain each record's provenance and context. If multiple unreplaced values
remain, Hortinis applies its product policy or abstains; the catalog does not silently choose one.

## Names

Localized names carry BCP 47 language tags and explicit preferred/alias status. A cultivar denomination is
language-neutral identity and is not automatically translated. Consumers may fall back only to an
explicitly tagged name; missing translations are reported, not invented.

## Runtime boundary

The catalog excludes garden plantings, user observations, forecasts, tasks, final recommendations and
synchronization operations. Hortinis owns those runtime data and decisions.
