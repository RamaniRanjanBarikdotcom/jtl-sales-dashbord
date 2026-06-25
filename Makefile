.PHONY: test-backend test-web test-all compose-config

compose-config:
	docker compose config
	docker compose -f docker-compose.prod.yml config

test-backend:
	docker compose -f docker-compose.test.yml run --rm --build backend-test

test-web:
	docker compose -f docker-compose.test.yml run --rm --build frontend-test

test-all: test-backend test-web
