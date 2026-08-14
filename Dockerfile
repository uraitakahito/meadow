# meadow — fixture-origin container.
# Multi-stage: build TypeScript in a full image, ship only prod deps + dist + site.

FROM node:26-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: prepare would fire before sources are copied; the build
# is invoked explicitly below.
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY scripts ./scripts

# The fingerprint /__version reports. The build context has no .git
# (.dockerignore), so generate-version.mjs reads these rather than asking git.
# Left unset the image reports version=unknown revision=dev — itself a useful
# signal: it was baked without recording what it was baked from.
ARG GIT_TAG=
ENV GIT_TAG=$GIT_TAG
ARG GIT_REV=dev
ENV GIT_REV=$GIT_REV

RUN npm run build

FROM node:26-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
# --ignore-scripts: prepare needs tsc (a devDep, omitted here); dist/ is
# copied prebuilt from the build stage.
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY site ./site
# Served on 0.0.0.0:8080 so a worker's Chrome (another VM) reaches it by IP.
EXPOSE 8080
CMD ["node", "dist/serve.js"]
