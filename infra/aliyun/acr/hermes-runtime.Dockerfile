# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS runtime

WORKDIR /opt/altselfs/hermes-agent

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates python3 python3-venv python3-pip \
  && rm -rf /var/lib/apt/lists/*

COPY . ./

RUN touch README.md \
  && python3 -m venv /opt/altselfs/hermes-agent/.venv \
  && /opt/altselfs/hermes-agent/.venv/bin/pip install --no-cache-dir -i https://mirrors.aliyun.com/pypi/simple --trusted-host mirrors.aliyun.com -U pip setuptools wheel \
  && /opt/altselfs/hermes-agent/.venv/bin/pip install --no-cache-dir -i https://mirrors.aliyun.com/pypi/simple --trusted-host mirrors.aliyun.com -e '/opt/altselfs/hermes-agent[acp]' \
  && printf '%s\n' \
    '#!/bin/sh' \
    'set -eu' \
    'if [ "${1:-}" = "run" ]; then shift; fi' \
    'while [ "$#" -gt 0 ]; do' \
    '  case "$1" in' \
    '    --extra) shift 2 ;;' \
    '    python) shift; exec /opt/altselfs/hermes-agent/.venv/bin/python "$@" ;;' \
    '    *) shift ;;' \
    '  esac' \
    'done' \
    'exec /opt/altselfs/hermes-agent/.venv/bin/python "$@"' \
    > /usr/local/bin/altselfs-hermes-run \
  && chmod +x /usr/local/bin/altselfs-hermes-run

ENV HERMES_SOURCE_ROOT=/opt/altselfs/hermes-agent
ENV UV_BIN=/usr/local/bin/altselfs-hermes-run
ENTRYPOINT ["/usr/local/bin/altselfs-hermes-run"]
