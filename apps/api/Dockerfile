# Depowar API — production image. pnpm v10's `deploy` produces a standalone
# folder containing the built package + its production workspace dependencies.
FROM node:20-alpine AS build
RUN corepack enable
WORKDIR /app

# Install with the lockfile first for better layer caching.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @paymesh/api build
RUN pnpm --filter @paymesh/api --prod deploy /out/api

FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/api ./
EXPOSE 4000
CMD ["node", "dist/main.js"]