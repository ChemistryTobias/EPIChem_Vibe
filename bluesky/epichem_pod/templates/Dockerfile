# {{name}} as a container. Build: docker build -t {{name}} .
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends git redis-server \
    && rm -rf /var/lib/apt/lists/*

# epichem-pod from the EPIChem repository (or a wheel / an index you host).
ARG EPICHEM_POD="epichem-pod @ git+https://github.com/ChemistryTobias/EPIChem_Vibe#subdirectory=bluesky"
RUN pip install --no-cache-dir "$EPICHEM_POD"
# Your drivers' own dependencies:
# RUN pip install --no-cache-dir mylab-drivers

WORKDIR /station
COPY . /station

ENV STATION_NAME={{name}} \
    EPICHEM_POD_PORT=60610
EXPOSE 60610
# EPICHEM_URL (announce to EPIChem), EPICHEM_POD_URL (how EPIChem reaches this
# pod) and QSERVER_HTTP_SERVER_SINGLE_USER_API_KEY come from the environment.
CMD ["epichem-pod", "serve", "/station/station.py"]
