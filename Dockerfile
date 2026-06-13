FROM oven/bun:1.3.11 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY worker ./worker
RUN bun run build

FROM oven/bun:1.3.11-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY --from=build /app/dist ./dist
COPY ops/certs ./certs
EXPOSE 3000
CMD ["bun", "dist/scripts/startProductionApi.js"]
