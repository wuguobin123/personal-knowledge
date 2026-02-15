ARG NODE_IMAGE=node:20-alpine
FROM ${NODE_IMAGE} AS base

WORKDIR /app

FROM base AS deps

COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./

RUN npm ci

FROM deps AS builder

COPY . .
RUN npm run build

FROM base AS runner

ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts

EXPOSE 3000

CMD ["npm", "run", "start"]
