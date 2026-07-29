.PHONY: test-backend test-web test-all compose-config smoke-docker redeploy-api

compose-config:
	docker compose config --quiet
	BACKEND_ENV_FILE=./backend/.env.production.example JTL_API_IMAGE=example.invalid/jtl-api:sha JTL_WEB_IMAGE=example.invalid/jtl-web:sha docker compose -f docker-compose.prod.yml config --quiet

test-backend:
	docker compose -f docker-compose.test.yml run --rm --build backend-test

test-web:
	docker compose -f docker-compose.test.yml run --rm --build frontend-test

test-all: test-backend test-web

smoke-docker:
	sh scripts/run-local-smoke.sh

redeploy-api:
	docker compose -f docker-compose.prod.yml pull nestjs-api
	docker compose -f docker-compose.prod.yml up -d --force-recreate --no-deps nestjs-api
	docker compose -f docker-compose.prod.yml ps nestjs-api
