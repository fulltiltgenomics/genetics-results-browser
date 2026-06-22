# BFF (backend-for-frontend): assembles POST /v1/results from the genetics-results-api fan-out and
# proxies every other /api/* call straight through. Runs the TypeScript entrypoint directly via tsx
# (same as `npm run bff` in dev), so there is no separate build step.
#
# Build from the repo ROOT with this file:  docker build -f bff/Dockerfile -t <img> .
FROM node:20-slim

WORKDIR /app

# install deps first for layer caching; tsx (used to run the TS entrypoint) is a devDependency,
# so we keep dev deps. no postinstall scripts in this package, so npm ci pulls nothing extra.
COPY package*.json ./
RUN npm ci

# BFF sources + the shared types they import (../src/types/types.normalized -> ./types) + tsconfig
COPY bff ./bff
COPY src ./src
COPY tsconfig.json ./

ENV NODE_ENV=production
# BFF_PORT and GENETICS_API_URL / GENETICS_API_TOKEN are supplied by the deployment env.
ENV BFF_PORT=5000
EXPOSE 5000

CMD ["npx", "tsx", "bff/server.ts"]
