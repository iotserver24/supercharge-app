FROM caddy:2-alpine AS caddy

FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl bash \
  && rm -rf /var/lib/apt/lists/*

# Official Supercharge CLI (same installer the desktop uses).
RUN curl -fsSL https://raw.githubusercontent.com/iotserver24/supercharge-releases/main/scripts/install.sh | bash \
  && install -m 755 /root/.local/bin/supercharge /usr/local/bin/supercharge \
  && if [ -x /root/.local/bin/supercharge-pager ]; then install -m 755 /root/.local/bin/supercharge-pager /usr/local/bin/supercharge-pager; fi

COPY --from=caddy /usr/bin/caddy /usr/bin/caddy
COPY server/Caddyfile /etc/caddy/Caddyfile
COPY server/web /opt/supercharge-web
COPY server/entrypoint.sh /usr/local/bin/supercharge-server
RUN chmod +x /usr/local/bin/supercharge-server \
  && useradd --create-home --uid 1000 --shell /bin/bash supercharge \
  && mkdir -p /workspace /home/supercharge \
  && chown -R supercharge:supercharge /workspace /home/supercharge

ENV HOME=/home/supercharge
ENV SUPERCHARGE_HOME=/home/supercharge/.supercharge
WORKDIR /workspace
EXPOSE 6767

USER supercharge
ENTRYPOINT ["/usr/local/bin/supercharge-server"]
