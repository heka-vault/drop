FROM denoland/deno:2.9.7
WORKDIR /app
COPY deno.json deno.lock ./
COPY main.ts ./
COPY src ./src
RUN deno cache main.ts src/cli.ts && chmod -R a+rX /deno-dir /app
# Inside the container both apps listen on all interfaces; compose decides what the host exposes.
ENV HEKA_DROP_DB=/data/drop.db \
    HEKA_DROP_API_HOST=0.0.0.0 \
    HEKA_DROP_API_PORT=8091 \
    HEKA_DROP_PUBLIC_HOST=0.0.0.0 \
    HEKA_DROP_PUBLIC_PORT=8090
EXPOSE 8090 8091
USER deno
# Scoped permissions: code from /app, data in /data only.
ENTRYPOINT ["deno", "run", "--cached-only", "--allow-net", "--allow-env", "--allow-read=/app,/data", "--allow-write=/data", "main.ts"]
CMD ["serve"]
