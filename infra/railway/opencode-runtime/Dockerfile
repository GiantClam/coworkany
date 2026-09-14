FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
  ca-certificates \
  git \
  ripgrep \
  python3 \
  python3-venv \
  fonts-dejavu-core \
  fonts-dejavu-extra \
  fonts-liberation \
  fonts-noto-cjk \
  make \
  g++ \
  && rm -rf /var/lib/apt/lists/* \
  && npm install --global opencode-ai@1.18.30

WORKDIR /app

COPY package.json ./package.json
COPY package-lock.json ./package-lock.json
COPY tsconfig.json ./tsconfig.json

RUN npm ci --legacy-peer-deps

COPY lib/ai-runtime ./lib/ai-runtime
COPY lib/writer/config.ts ./lib/writer/config.ts
COPY lib/writer/runtime ./lib/writer/runtime
COPY infra/railway/opencode-runtime ./infra/railway/opencode-runtime
COPY infra/cloudflare/opencode-runner/runtime ./runtime

# The editable PPT agent is OpenCode-led, but it executes the upstream native
# ppt-master skill inside the persistent Railway session workspace. Pin the
# skill revision so a future upstream change cannot silently alter production
# artifact behavior.
ARG PPT_MASTER_REF=465e3b4149b852d33ddd1cb94ac059401fe4e823
RUN git clone --depth 1 https://github.com/hugohe3/ppt-master.git /opt/ppt-master \
  && test "$(git -C /opt/ppt-master rev-parse HEAD)" = "$PPT_MASTER_REF" \
  && python3 -m venv /opt/ppt-master-venv \
  && /opt/ppt-master-venv/bin/pip install --no-cache-dir --retries 10 --timeout 120 -r /opt/ppt-master/requirements.txt \
  && mkdir -p /app/runtime/skills \
  && cp -R /opt/ppt-master/skills/ppt-master /app/runtime/skills/ppt-master \
  && test -f /app/runtime/skills/ppt-master/SKILL.md

ARG DASHI_PPT_SKILL_REF=ff3a7330e4967147a40310669703b911fb1f708a
RUN git init /tmp/dashi-ppt-skill \
  && git -C /tmp/dashi-ppt-skill remote add origin https://github.com/chuspeeism/dashi-ppt-skill.git \
  && git -C /tmp/dashi-ppt-skill fetch --depth 1 origin "$DASHI_PPT_SKILL_REF" \
  && git -C /tmp/dashi-ppt-skill checkout --detach FETCH_HEAD \
  && mv /tmp/dashi-ppt-skill/skills/dashi-ppt /opt/dashiai-ppt \
  && rm -rf /tmp/dashi-ppt-skill \
  && npm --prefix /opt/dashiai-ppt/project ci --ignore-scripts --no-audit --no-fund \
  && PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright npm --prefix /opt/dashiai-ppt/project exec -- playwright-core install --with-deps chromium-headless-shell

RUN npx tsc -p infra/railway/opencode-runtime/tsconfig.json --noEmit

ENV OPENCODE_RUNTIME_DIR=/data/sessions
ENV OPENCODE_RUNTIME_BUNDLE_DIR=/app/runtime
ENV OPENCODE_RUNTIME_BUNDLE_VERSION=runtime-bundle-v2
ENV OPENCODE_RUN_TIMEOUT_MS=3600000
ENV PPT_MASTER_REPO_DIR=/opt/ppt-master
ENV PPT_MASTER_PYTHON_BIN=/opt/ppt-master-venv/bin/python
ENV PPT_MASTER_VENV_DIR=/opt/ppt-master-venv
# Native ppt-master commands invoke `python3` and `rg` directly. Put the
# prebuilt dependency venv first so every turn does not reinstall Pillow/
# python-pptx, and install ripgrep in the image so the skill does not download
# it into each session workspace.
ENV PATH=/opt/ppt-master-venv/bin:$PATH
ENV PIP_DISABLE_PIP_VERSION_CHECK=1
ENV DASHI_PPT_PROJECT_ROOT=/opt/dashiai-ppt/project
ENV DASHI_PPT_PREVIEW_HOST=127.0.0.1
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright

CMD ["npx", "tsx", "infra/railway/opencode-runtime/src/server.ts"]
