FROM node:22-bookworm-slim AS node-runtime

FROM python:3.12-slim-bookworm

ARG SERVICE_UID=10001
ARG SERVICE_GID=10001
ARG GITNEXUS_VERSION=1.6.8

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/src \
    HOME=/home/giteam \
    NPM_CONFIG_CACHE=/var/lib/giteam/remote-repo-service/npm-cache

RUN apt-get update \
    && apt-get install --yes --no-install-recommends git ca-certificates libstdc++6 build-essential openssh-client \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid "${SERVICE_GID}" giteam \
    && useradd --uid "${SERVICE_UID}" --gid giteam --create-home --shell /usr/sbin/nologin giteam \
    && mkdir -p /etc/giteam /var/lib/giteam/remote-repo-service \
    && chown -R giteam:giteam /etc/giteam /var/lib/giteam /home/giteam

# GitNexus 1.6+ requires Node 22. Copy the official Node runtime rather than
# Debian bookworm's Node 18 package, which appears to install correctly but
# cannot execute the current GitNexus CLI.
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node-runtime /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

# Keep GitNexus out of the runtime npm cache. The service may run analyses
# concurrently, while npx installs and cleans its cache lazily.
RUN npm install --global --omit=dev "gitnexus@${GITNEXUS_VERSION}" \
    && gitnexus --version

# The persistent volume may contain repos created by a different container UID
# or restored from a Mac/backup. Git refuses those worktrees unless explicitly
# trusted inside the container.
RUN git config --system --add safe.directory '*'

WORKDIR /app

COPY pyproject.toml ./
COPY src ./src

RUN pip install --no-cache-dir .

USER giteam

EXPOSE 8765

CMD ["remote-repo-service", "start", "--host", "0.0.0.0", "--port", "8765"]
