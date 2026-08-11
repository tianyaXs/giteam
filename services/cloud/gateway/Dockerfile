# Legacy gateway-only image.
# Prefer the unified image from repository root:
#   docker build -f services/cloud/Dockerfile -t giteam-cloud .
#
# syntax=docker/dockerfile:1
FROM rust:1.88-bookworm AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
COPY Cargo.toml Cargo.lock* ./
COPY migrations ./migrations
COPY src ./src
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libssl3 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/target/release/giteam-cloud-gateway /usr/local/bin/giteam-cloud-gateway
COPY --from=builder /app/migrations ./migrations
ENV LISTEN_ADDR=0.0.0.0:8787
EXPOSE 8787
CMD ["giteam-cloud-gateway"]
