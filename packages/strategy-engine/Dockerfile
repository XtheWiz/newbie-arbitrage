FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY packages/strategy-engine ./packages/strategy-engine

RUN npm ci --workspace=@polymarket-arb/shared --workspace=@polymarket-arb/strategy-engine
RUN npm run build --workspace=@polymarket-arb/shared
RUN npm run build --workspace=@polymarket-arb/strategy-engine

FROM node:20-alpine
WORKDIR /app

COPY --from=builder /app/packages/strategy-engine/dist ./dist
COPY --from=builder /app/packages/strategy-engine/package.json ./
COPY --from=builder /app/node_modules ./node_modules

ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
