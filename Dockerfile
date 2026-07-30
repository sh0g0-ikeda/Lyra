FROM --platform=$BUILDPLATFORM oven/bun:1.3.14 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
COPY packages ./packages
COPY scripts ./scripts
COPY worker ./worker
RUN bun run build

FROM oven/bun:1.3.14 AS production-deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM --platform=$BUILDPLATFORM node:24-slim AS web-build
WORKDIR /app/apps/web
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci
COPY apps/web ./
ARG VITE_API_BASE_URL=
ARG VITE_COGNITO_DOMAIN=https://ap-northeast-1wizlzlgmm.auth.ap-northeast-1.amazoncognito.com
ARG VITE_COGNITO_CLIENT_ID=6b2h941o888u2l7ejhv5jog94
ARG VITE_COGNITO_REDIRECT_URI=https://app.lyra-editor.com/auth/callback
ARG VITE_COGNITO_LOGOUT_URI=https://app.lyra-editor.com
ARG VITE_COGNITO_SCOPES="openid email"
ARG VITE_COGNITO_API_TOKEN_USE=id
ARG VITE_ORGANIZATION_FEATURES_ENABLED=true
ENV LYRA_STRICT_WEB_PRODUCTION_CONFIG=true
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_COGNITO_DOMAIN=$VITE_COGNITO_DOMAIN
ENV VITE_COGNITO_CLIENT_ID=$VITE_COGNITO_CLIENT_ID
ENV VITE_COGNITO_REDIRECT_URI=$VITE_COGNITO_REDIRECT_URI
ENV VITE_COGNITO_LOGOUT_URI=$VITE_COGNITO_LOGOUT_URI
ENV VITE_COGNITO_SCOPES=$VITE_COGNITO_SCOPES
ENV VITE_COGNITO_API_TOKEN_USE=$VITE_COGNITO_API_TOKEN_USE
ENV VITE_ORGANIZATION_FEATURES_ENABLED=$VITE_ORGANIZATION_FEATURES_ENABLED
RUN npm run build

FROM oven/bun:1.3.14-distroless@sha256:c28c51287af70bab8e0b66fc4b6a30cfb92a727ebc88045223adc9f4c9d09307 AS runtime
ENV NODE_ENV=production
ENV WEB_STATIC_DIR=./public
ENV LD_LIBRARY_PATH=/usr/lib
WORKDIR /app
COPY --from=production-deps /usr/lib/*-linux-gnu/libstdc++.so.6* /usr/lib/
COPY --from=production-deps /lib/*-linux-gnu/libgcc_s.so.1 /usr/lib/
COPY --chown=65532:65532 package.json bun.lock ./
COPY --chown=65532:65532 --from=production-deps /app/node_modules ./node_modules
COPY --chown=65532:65532 --from=build /app/dist ./dist
COPY --chown=65532:65532 --from=web-build /app/apps/web/dist ./public
COPY --chown=65532:65532 migrations ./migrations
COPY --chown=65532:65532 ops/certs ./certs
USER 65532:65532
EXPOSE 3000
ENTRYPOINT []
CMD ["/usr/local/bin/bun", "dist/scripts/startProductionApi.js"]
