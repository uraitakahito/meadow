# meadow — fixture-origin container.
# Multi-stage: build TypeScript in a full image, ship only prod deps + dist + site.

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: prepare would fire before sources are copied; the build
# is invoked explicitly below.
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim
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
