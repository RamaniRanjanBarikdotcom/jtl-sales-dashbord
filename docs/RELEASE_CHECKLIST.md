# Release Checklist

## Code
- [ ] Backend tests pass
- [ ] Frontend tests pass
- [ ] Docker build passes
- [ ] Migrations tested

## Security
- [ ] No secrets in Git
- [ ] Secret scan passes
- [ ] Production env values rotated if needed
- [ ] Old exposed PgBouncer/database credentials rotated
- [ ] Git history purge completed if secrets were committed before
- [ ] CORS/CSP checked

## Docs
- [ ] README updated
- [ ] DEPLOY updated
- [ ] Feature CSV updated
- [ ] Env examples updated

## Deployment
- [ ] `docker-compose.prod.yml` config passes
- [ ] Public `/api/healthz` health check passes
- [ ] Protected `/api/admin/health` diagnostics checked
- [ ] HTTPS works
- [ ] Sync engine can connect
