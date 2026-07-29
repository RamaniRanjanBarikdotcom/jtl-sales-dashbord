# Testing Strategy

Required gates are backend typecheck/tests/build, frontend tests/production build, .NET solution build, migration review, and a staging smoke test using two tenants. Security smoke tests must verify cross-tenant rejection, missing tenant rejection, permission removal on the next request, invalid sync key rejection, command double-claim prevention, metadata redaction, and disabled feature behavior.
