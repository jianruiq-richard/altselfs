# syntax=docker/dockerfile:1

FROM rust:1.95-bookworm AS build

WORKDIR /opt/altselfs/codex
COPY . ./

WORKDIR /opt/altselfs/codex/codex-rs
ENV CARGO_PROFILE_DEV_DEBUG=0
ENV CARGO_BUILD_JOBS=1

RUN rm -f rust-toolchain.toml \
  && rustc --version \
  && cargo --version \
  && cargo build --locked -p codex-app-server --bin codex-app-server

RUN mkdir -p /opt/altselfs/codex-bin \
  && cp /opt/altselfs/codex/codex-rs/target/debug/codex-app-server /opt/altselfs/codex-bin/codex-app-server \
  && printf '%s\n' \
    '#!/bin/sh' \
    'set -eu' \
    'if [ "${1:-}" = "app-server" ]; then' \
    '  shift' \
    '  exec /opt/altselfs/codex-bin/codex-app-server "$@"' \
    'fi' \
    'echo "This Altselfs Codex wrapper only supports: codex app-server" >&2' \
    'exit 64' \
    > /opt/altselfs/codex-bin/codex \
  && chmod +x /opt/altselfs/codex-bin/codex /opt/altselfs/codex-bin/codex-app-server

FROM debian:bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /opt/altselfs/codex-bin /opt/altselfs/codex-bin

ENV CODEX_BIN=/opt/altselfs/codex-bin/codex
ENTRYPOINT ["/opt/altselfs/codex-bin/codex"]
