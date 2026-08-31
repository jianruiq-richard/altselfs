FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN npm run build \
  && npm prune --omit=dev \
  && chmod 0755 ./docker-entrypoint.sh \
  && install -d ./runtime \
  && cp package.json package-lock.json docker-entrypoint.sh ./runtime/ \
  && cp -a node_modules dist ./runtime/

FROM mcr.microsoft.com/playwright:v1.62.1-noble AS runtime

WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends novnc websockify x11-utils x11vnc xvfb \
  && rm -rf /var/lib/apt/lists/*
RUN curl -fsSLo /tmp/google-chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
  && apt-get update \
  && apt-get install -y --no-install-recommends /tmp/google-chrome.deb \
  && rm -f /tmp/google-chrome.deb \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
  PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  SEMRUSH_PROVIDER=browser \
  SEMRUSH_BROWSER_CONNECTION=cdp \
  SEMRUSH_BROWSER_MANAGED=true \
  SEMRUSH_BROWSER_HEADLESS=false \
  SEMRUSH_BROWSER_NO_SANDBOX=true \
  SEMRUSH_BROWSER_MANAGE_FILTERS=true \
  SEMRUSH_QUEUE_MAX_WAITING=3 \
  SEMRUSH_BROWSER_EXECUTABLE=/usr/bin/google-chrome
COPY --from=build /app/runtime/ ./

CMD ["/app/docker-entrypoint.sh"]
