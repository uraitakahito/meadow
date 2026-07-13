# meadow — fixture-origin container.
# Multi-stage: build TypeScript in a full image, ship only prod deps + dist + site.

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY site ./site
# Served on 0.0.0.0:8080 so a worker's Chrome (another VM) reaches it by IP.
EXPOSE 8080
CMD ["node", "dist/serve.js"]
