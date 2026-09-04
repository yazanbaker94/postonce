# syntax=docker/dockerfile:1.7
FROM node:22.23.2-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS workspace
WORKDIR /srv/postonce
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json

FROM workspace AS build
RUN npm ci --workspace @postonce/contracts --workspace @postonce/api --include-workspace-root=false
COPY packages/contracts packages/contracts
COPY apps/api apps/api
COPY database database
RUN npm run build --workspace @postonce/contracts \
  && npm run build --workspace @postonce/api

FROM workspace AS production-dependencies
RUN npm ci --omit=dev --ignore-scripts \
  --workspace @postonce/contracts --workspace @postonce/api --include-workspace-root=false \
  && npm cache clean --force

FROM node:22.23.2-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS runtime
ENV NODE_ENV=production \
    PORT=3001
WORKDIR /srv/postonce
COPY --from=production-dependencies --chown=node:node /srv/postonce/node_modules ./node_modules
COPY --chown=node:node package.json ./package.json
COPY --chown=node:node apps/api/package.json apps/api/package.json
COPY --chown=node:node packages/contracts/package.json packages/contracts/package.json
COPY --from=build --chown=node:node /srv/postonce/apps/api/dist apps/api/dist
COPY --from=build --chown=node:node /srv/postonce/packages/contracts/dist packages/contracts/dist
COPY --from=build --chown=node:node /srv/postonce/database database
USER node
EXPOSE 3001
CMD ["sh", "-c", "node database/migrate.mjs && exec node apps/api/dist/main.js"]
