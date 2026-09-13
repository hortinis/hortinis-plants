# Schema compatibility

- Status: planned

Compatibility policy is intentionally deferred until coordinated with Hortinis. C2 establishes stable V1
schema identifiers and a `minimumConsumerVersion` manifest field, but does not claim a compatibility
guarantee, define how versions are compared, or ship compatibility tables and migration fixtures.

The present structural rules are limited to schema validation: consumer schemas use identifiers under
`urn:hortinis:plants:schema:v1:`, and the V1 release-manifest schema accepts schema-version strings in the
`1.x` family. A consumer must not interpret that syntax check as proof that it can safely consume a
release.

When Hortinis and the catalog agree on policy, this document should define additive versus breaking
changes, minimum consumer enforcement, retained identifiers for user history, migration behavior and
positive/negative cross-version fixtures. Until then, contract changes that affect consumers require
explicit coordination rather than an assumed compatibility rule.
