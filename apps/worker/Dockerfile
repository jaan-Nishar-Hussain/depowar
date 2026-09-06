# Depowar worker — production image (BullMQ consumers + settlement/fallback).
FROM node:20-alpine AS build
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @paymesh/worker build
RUN pnpm --filter @paymesh/worker --prod deploy /out/worker

FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/worker ./
CMD ["node", "dist/index.js"]