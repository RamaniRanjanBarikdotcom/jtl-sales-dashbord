FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── Production image ──────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

ARG APP_VERSION=1.0.0
ARG BUILD_SHA=development
ARG BUILD_TIME=unknown

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY init-db ./init-db
COPY scripts/apply-schema.js ./scripts/apply-schema.js

RUN mkdir -p logs

ENV NODE_ENV=production
ENV APP_VERSION=$APP_VERSION
ENV BUILD_SHA=$BUILD_SHA
ENV BUILD_TIME=$BUILD_TIME
LABEL org.opencontainers.image.version=$APP_VERSION
LABEL org.opencontainers.image.revision=$BUILD_SHA
LABEL org.opencontainers.image.created=$BUILD_TIME
EXPOSE 3001

CMD ["node", "dist/main"]
