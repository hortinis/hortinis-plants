# ADR-0004: Project and data licensing

- Status: validated

## Decision

License pipeline code under `AGPL-3.0-only`. License original Hortinis-authored assertions under `CC-BY-4.0`.

Imported assertions retain their source-specific rights. A repository, compilation or profile licence never replaces an assertion's source licence.

Commercial profiles may include verified CC BY-SA assertions. When ShareAlike applies to an adapted release database, publish that database under a compatible ShareAlike licence and meet its attribution, modification-notice and no-additional-restrictions requirements. Exclude CC BY-NC, unknown, unsupported and inseparably mixed-rights content.

## Consequences

The source repository being public is not by itself licence compliance. Each included assertion still requires an accepted record-level licence decision and locator. Practical Plants remains blocked until extraction reliably distinguishes eligible ShareAlike blocks from NonCommercial blocks.

Release manifests must state the rights applying to the compilation and to included assertions without implying that one licence covers every source record.
