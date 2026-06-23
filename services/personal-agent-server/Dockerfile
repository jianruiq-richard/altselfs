FROM node:22-bookworm-slim AS deps

WORKDIR /app

COPY package.json tsconfig.json ./
RUN npm install

FROM deps AS build

WORKDIR /app
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

# The product server spawns `codex app-server`. Pin this package after the
# controlled-kernel version is locked.
RUN npm install -g @openai/codex

COPY package.json ./
RUN npm install --omit=dev

COPY --from=build /app/dist ./dist

ENV NODE_ENV=production
ENV ALTSELFS_AGENT_ENV=production
ENV PORT=8787

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
