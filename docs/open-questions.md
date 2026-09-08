# Open questions

The former release and coordination questions are resolved by ADR-0004 through ADR-0006.

## Foundation tooling choices

- C1.2b TypeScript compiler API bridge: should the repository follow the TypeScript team's
  side-by-side transition layout, keeping TypeScript 7 as `@typescript/native` for builds while
  exposing `@typescript/typescript6` as `typescript` for typescript-eslint?
- C1.2b lint depth: should the initial ESLint configuration use the stable type-checked recommended
  rules, or begin with the syntax-aware recommended rules while the compiler transition settles?
- C1.2b generated paths: which repository paths will be reserved for downloaded source inputs and
  generated release artifacts so Git, ESLint and Prettier can share explicit ignore rules?

## Deferred choices

- Cultivar-level timing at scale.
- Pest and disease recommendations.
- Companion planting, rotation and succession.
- Perennial and tree lifecycle data.
- Community contribution and public editorial workflow.
- Exact scope, source policy and delivery contract for optional image packs.
- Climate-cell resolution, sources, reference period and contract in the planned separate `hortinis-climate` repository.
- Artifact signing and key rotation if a future threat model requires authenticity beyond trusted local selection or authenticated HTTPS.
