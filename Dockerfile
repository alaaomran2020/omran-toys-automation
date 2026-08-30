# syntax=docker/dockerfile:1

# ============================================================
# Omran Toys Automation — production image
# Node 22 (built-in node:sqlite, no native deps to compile)
# ============================================================

FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY scripts ./scripts

# Runtime data (SQLite + product images) — mount a volume at /data
VOLUME /data
ENV DATABASE_PATH=/data/automation.db \
    STORAGE_DIR=/data/storage

EXPOSE 3000
CMD ["node", "dist/index.js"]
