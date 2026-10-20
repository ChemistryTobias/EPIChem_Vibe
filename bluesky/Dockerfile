# EPIChem station pod (Roadmap 1.3): the epichem-pod package -- queueserver +
# HTTP server over ophyd devices -- serving one station profile. The example
# profiles run simulated drivers; see docs/BLUESKY.md to make your own
# (`epichem-pod init` writes a Dockerfile for a single station.py).
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /pod
COPY pyproject.toml README.md ./
COPY epichem_pod ./epichem_pod
RUN pip install --no-cache-dir .

COPY profiles ./profiles

# Which station this container is: a directory under profiles/ (or mount your
# own and point STATION_PATH at it, a directory or a station.py).
ENV STATION_PROFILE=spinbot \
    EPICHEM_POD_PORT=60610
EXPOSE 60610
HEALTHCHECK --interval=5s --timeout=3s --start-period=30s --retries=10 \
  CMD python -c "import urllib.request,os; urllib.request.urlopen(urllib.request.Request('http://localhost:60610/api/status', headers={'Authorization': 'ApiKey ' + os.environ['QSERVER_HTTP_SERVER_SINGLE_USER_API_KEY']}))"

CMD ["sh", "-c", "exec epichem-pod serve \"${STATION_PATH:-/pod/profiles/$STATION_PROFILE}\" --name \"${STATION_NAME:-$STATION_PROFILE}\""]
