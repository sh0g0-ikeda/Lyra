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

FROM node:24-slim AS web-build
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

FROM oven/bun:1.3.11-slim AS runtime
ENV NODE_ENV=production
ENV WEB_STATIC_DIR=./public
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY --from=build /app/dist ./dist
COPY --from=web-build /app/apps/web/dist ./public
COPY migrations ./migrations
COPY ops/certs ./certs
EXPOSE 3000
CMD ["bun", "dist/scripts/startProductionApi.js"]
