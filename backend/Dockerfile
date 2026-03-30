FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install --legacy-peer-deps

COPY . .
RUN npm run build

# ── Production image ──────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev --legacy-peer-deps

COPY --from=builder /app/dist ./dist
COPY init-db ./init-db

RUN mkdir -p logs

ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "dist/main"]
