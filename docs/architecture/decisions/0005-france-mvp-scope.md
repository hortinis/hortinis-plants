# ADR-0005: France MVP scope

- Status: validated

## Context

The Société Nationale d'Horticulture de France lists `Marmande` among principal medium-season tomato varieties and `Montfavet 63-5` among principal early varieties. INRAE identifies `Montfavet H 63-5 F1` as a French-bred variety still grown by many amateur gardeners. These references justify their relevance as French MVP exemplars but do not by themselves grant redistribution rights to descriptive data.

- [SNHF tomato guide](https://www.snhf.org/fiche-plante/tomate/)
- [INRAE varietal creation history](https://gafl.paca.hub.inrae.fr/nos-resultats/creation-varietale-innovation)

## Decision

The first `fr-mvp` profile targets outdoor and unheated-shelter cultivation in metropolitan France, including Corsica and excluding overseas territories. Validation covers representative Atlantic, continental, Mediterranean and mountain contexts and reports limitations rather than claiming uniform national applicability.

The initial allowlist contains 33 generic plant concepts:

- fruiting crops: tomato, sweet pepper, aubergine, cucumber, courgette, winter squash or pumpkin, and melon;
- roots and tubers: potato, carrot, radish, beetroot, turnip, and parsnip;
- alliums: onion, garlic, shallot, and leek;
- leaves: lettuce, spinach, and chard;
- legumes: pea, French bean, and broad bean;
- brassicas: cabbage, broccoli, cauliflower, and kale;
- herbs: basil, parsley, coriander, chives, thyme, and rosemary.

Tomato `Marmande` and tomato `Montfavet H 63-5 F1` are the two initial cultivar exemplars, subject to identity reconciliation and redistribution-cleared evidence. Curated cultivar coverage is otherwise optional for the MVP.

Every MVP plant concept should have reviewed French and English preferred names when suitable evidence is available. Missing localization does not block release: consumers use a deterministic fallback to another explicitly tagged name and then to the scientific name.

## Cultivar behavior

A user may select a generic plant concept without selecting a cultivar. A user may instead select an optional catalog cultivar or retain a free-form cultivar label.

Assertions declare whether they apply to a plant concept, cultivar group or named cultivar. Narrower evidence is never promoted to the generic plant concept. When a cultivar-dependent fact is needed but the cultivar is unknown, the projection exposes a limitation or abstains.

## Governance

The sole maintainer may import, review, accept licence decisions and approve releases. The workflow still records explicit horticultural and licence decisions for each released assertion; no independent or second reviewer is required during the sole-maintainer phase.
