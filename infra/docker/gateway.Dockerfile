# syntax=docker/dockerfile:1.7
FROM node:22.23.2-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS build
WORKDIR /srv/postonce
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci --workspace @postonce/web --include-workspace-root=false
COPY packages/contracts packages/contracts
COPY apps/web apps/web
RUN npm run build --workspace @postonce/contracts
RUN npm run build --workspace @postonce/web

FROM caddy:2.11.4-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648 AS runtime
# The upstream binary carries CAP_NET_BIND_SERVICE for ports below 1024. This
# gateway listens on 8080, so remove that file capability; otherwise Linux
# rejects exec when Compose applies both cap_drop: ALL and no-new-privileges.
RUN setcap -r /usr/bin/caddy \
  && test -z "$(getcap /usr/bin/caddy)"
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /srv/postonce/apps/web/dist /srv/postonce-web
EXPOSE 8080
