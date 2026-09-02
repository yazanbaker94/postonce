# syntax=docker/dockerfile:1.7
FROM node:22.23.2-bookworm-slim AS build
WORKDIR /srv/postonce
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci --workspace @postonce/web --include-workspace-root=false
COPY apps/web apps/web
RUN npm run build --workspace @postonce/web

FROM caddy:2.11.4-alpine AS runtime
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /srv/postonce/apps/web/dist /srv/postonce-web
EXPOSE 8080
