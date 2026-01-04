FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY packages/ingestor ./packages/ingestor

RUN npm ci --workspace=@polymarket-arb/shared --workspace=@polymarket-arb/ingestor
RUN npm run build --workspace=@polymarket-arb/shared
RUN npm run build --workspace=@polymarket-arb/ingestor

FROM node:20-alpine
WORKDIR /app

COPY --from=builder /app/packages/ingestor/dist ./dist
COPY --from=builder /app/packages/ingestor/package.json ./
COPY --from=builder /app/node_modules ./node_modules

ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
