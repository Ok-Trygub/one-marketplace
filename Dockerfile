FROM node:22-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build


FROM node:22-slim AS runner
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
USER node
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/health', { headers: { authorization: 'Bearer healthcheck' } }).then((res) => process.exit(res.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/src/server.js"]


FROM node:22-slim AS dev
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
USER node
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/health', { headers: { authorization: 'Bearer healthcheck' } }).then((res) => process.exit(res.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["npm", "run", "dev"]