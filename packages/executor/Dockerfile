FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY packages/executor ./packages/executor

RUN npm ci --workspace=@polymarket-arb/shared --workspace=@polymarket-arb/executor
RUN npm run build --workspace=@polymarket-arb/shared
RUN npm run build --workspace=@polymarket-arb/executor

FROM node:20-alpine
WORKDIR /app

COPY --from=builder /app/packages/executor/dist ./dist
COPY --from=builder /app/packages/executor/package.json ./
COPY --from=builder /app/node_modules ./node_modules

ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
