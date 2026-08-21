# EPIChem frontend image.
#
#   --target dev      Vite dev server with HMR, for compose.yaml
#   --target runtime  nginx serving the built bundle — what CI pushes
#
# `runtime` is last, so it is the default target.

# ---------------------------------------------------------------- deps
FROM node:20-alpine AS deps
WORKDIR /app
# package.json + lockfile only, so `npm ci` re-runs on dependency changes and
# not on every source edit.
COPY package.json package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------- dev
FROM node:20-alpine AS dev
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 5173
# --host is also set in vite.config.ts; repeated here so the image is correct
# even if someone runs it without that config.
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

# ---------------------------------------------------------------- build
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `npm run build` runs typecheck first (see package.json), so a type error
# fails the image build rather than shipping.
RUN npm run build

# ---------------------------------------------------------------- runtime
FROM nginx:1.27-alpine AS runtime

# The Vite dev proxy does not exist in production, so nginx takes over the same
# job: serve the bundle and proxy /api to the backend on the same origin. That
# keeps the browser talking to exactly one origin, which means no CORS
# configuration in production either — see docs/MILESTONE_CI_CD.md §1.
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

# nginx's entrypoint runs envsubst over everything in /etc/nginx/templates.
# Without a filter it would also expand nginx's own runtime variables ($uri,
# $host, ...) into empty strings and produce a broken config. The filter
# restricts substitution to our own variables.
ENV NGINX_ENVSUBST_FILTER="EPICHEM_" \
    EPICHEM_API_UPSTREAM="http://api:8000"

EXPOSE 8080
