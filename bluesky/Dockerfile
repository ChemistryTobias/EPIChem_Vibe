# EPIChem reference station pod (Roadmap 1.3): bluesky-queueserver + its HTTP
# server, an ophyd device namespace and annotated plans. Simulated devices by
# default; swap epichem_sim classes for EPICS-backed ophyd ones for hardware.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/pod

WORKDIR /pod
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY epichem_sim ./epichem_sim
COPY startup ./startup
COPY entrypoint.sh .

EXPOSE 60610
HEALTHCHECK --interval=5s --timeout=3s --start-period=20s --retries=10 \
  CMD python -c "import urllib.request,os; urllib.request.urlopen(urllib.request.Request('http://localhost:60610/api/status', headers={'Authorization': 'ApiKey ' + os.environ['QSERVER_HTTP_SERVER_SINGLE_USER_API_KEY']}))"

ENTRYPOINT ["/pod/entrypoint.sh"]
