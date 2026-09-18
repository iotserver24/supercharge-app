FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl bash nodejs \
  && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://raw.githubusercontent.com/iotserver24/supercharge-releases/main/scripts/install.sh | bash \
  && install -m 755 /root/.local/bin/supercharge /usr/local/bin/supercharge \
  && if [ -x /root/.local/bin/supercharge-pager ]; then install -m 755 /root/.local/bin/supercharge-pager /usr/local/bin/supercharge-pager; fi

COPY server/daemon.mjs /opt/supercharge-daemon/daemon.mjs
COPY server/web /opt/supercharge-daemon/web
COPY server/entrypoint.sh /usr/local/bin/supercharge-server
RUN chmod +x /usr/local/bin/supercharge-server \
  && useradd --create-home --uid 1000 --shell /bin/bash supercharge \
  && mkdir -p /workspace /home/supercharge \
  && chown -R supercharge:supercharge /workspace /home/supercharge /opt/supercharge-daemon

ENV HOME=/home/supercharge
ENV SUPERCHARGE_HOME=/home/supercharge/.supercharge
ENV SUPERCHARGE_WORKSPACE=/workspace
WORKDIR /workspace
EXPOSE 6767
USER supercharge
ENTRYPOINT ["/usr/local/bin/supercharge-server"]
