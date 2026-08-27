# Build from repository root:
#   docker build -f services/cloud/Dockerfile -t giteam-cloud .

# ---------- Admin console ----------
FROM node:22-bookworm AS console
WORKDIR /src
COPY apps/cloud/package.json apps/cloud/package-lock.json ./
RUN npm ci --no-fund --no-audit
COPY apps/cloud/ ./
RUN npm run build

# ---------- Gateway ----------
FROM rust:1.88-bookworm AS gateway
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev \
    && rm -rf /var/lib/apt/lists/*
COPY services/cloud/gateway/Cargo.toml services/cloud/gateway/Cargo.lock* ./
COPY services/cloud/gateway/migrations ./migrations
COPY services/cloud/gateway/src ./src
RUN cargo build --release

# ---------- Runtime ----------
FROM debian:bookworm-slim
# git：分享 finalize 时把 repo.bundle 物化为 bare + update-server-info
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libssl3 curl git \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=gateway /app/target/release/giteam-cloud-gateway /usr/local/bin/giteam-cloud-gateway
COPY --from=gateway /app/migrations ./migrations
COPY --from=console /src/dist ./static
ENV LISTEN_ADDR=0.0.0.0:8787
ENV STATIC_DIR=/app/static
EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8787/healthz || exit 1
CMD ["giteam-cloud-gateway"]
