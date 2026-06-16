FROM node:22-bookworm-slim AS base

WORKDIR /app

# Codex CLI is installed at image build time. In production this image should be
# pinned to a known Codex CLI version after compatibility testing.
RUN npm install -g @openai/codex

COPY package.json tsconfig.json ./
RUN npm install

COPY src ./src
RUN npm run build

ENV NODE_ENV=production
EXPOSE 8787

CMD ["node", "dist/index.js"]

