FROM python:3.11-slim-bookworm

ENV PYTHONUNBUFFERED=1
ENV PIP_DISABLE_PIP_VERSION_CHECK=1
ENV HOME=/tmp

WORKDIR /workspace

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    jq \
    bash \
  && pip install --no-cache-dir -i https://mirrors.aliyun.com/pypi/simple --trusted-host mirrors.aliyun.com \
    beautifulsoup4 \
    lxml \
    openpyxl \
    pandas \
    pdfplumber \
    pypdf \
    python-docx \
    requests \
  && rm -rf /var/lib/apt/lists/*

CMD ["/bin/sh"]
