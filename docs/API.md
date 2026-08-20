# API reference

The backend (`backend/app/`) is FastAPI, which generates its schema from the
actual routes — this page reads that schema directly rather than
hand-maintaining a copy that drifts the moment a route changes.

**Live, interactive** (needs the backend running — `docker compose up`, or
see `HOST_SETUP.md`): Swagger UI at <http://localhost:8000/docs>, ReDoc at
<http://localhost:8000/redoc>.

**Below**: the same schema, fetched and rendered by the small script at the
bottom of this page. It reads `openapi.json`, which the `docs:openapi` CI
job exports fresh from `app.openapi()` on every pipeline run (see
`.gitlab-ci.yml`'s `docs` stage) — so this table is never older than the
last build of `main`. Regenerate it locally the same way:

```bash
cd backend && .venv/bin/python -c "
import json
from app.main import app
json.dump(app.openapi(), open('../docs/openapi.json', 'w'), indent=2)"
```

`openapi.json` itself is gitignored — it's a build output, not something to
hand-edit or commit.

<div id="api-endpoints">Loading endpoints from <code>openapi.json</code>…</div>

<style>
#api-endpoints table { width: 100%; border-collapse: collapse; margin: 0.5em 0 1.5em; }
#api-endpoints th, #api-endpoints td { text-align: left; padding: 4px 10px; border-bottom: 1px solid #dcdcdc; }
#api-endpoints h3 { margin-top: 1.5em; }
#api-endpoints code { font-size: 0.85em; }
.api-method { display: inline-block; min-width: 3.5em; padding: 1px 6px; border-radius: 3px; font-size: 0.75em; font-weight: bold; color: #fff; text-align: center; }
.api-method-get { background: #006c66; }
.api-method-post { background: #00b1ea; }
.api-method-patch { background: #ef7c00; }
.api-method-put { background: #ef7c00; }
.api-method-delete { background: #c0392b; }
</style>

<script>
(async function () {
  const target = document.getElementById("api-endpoints");
  const candidates = ["openapi.json", "../openapi.json", "/openapi.json"];

  let schema = null;
  for (const url of candidates) {
    try {
      const res = await fetch(url);
      if (res.ok) { schema = await res.json(); break; }
    } catch (e) { /* try the next candidate */ }
  }

  if (!schema) {
    target.innerHTML =
      "<p><em>Couldn't load <code>openapi.json</code> from this page " +
      "(expected next to it or at the site root). Run the regenerate " +
      "command above, or check the live docs link instead.</em></p>";
    return;
  }

  // Group by the path's first segment (its resource: /sites, /labs, ...).
  const groups = {};
  for (const [path, methods] of Object.entries(schema.paths || {})) {
    const resource = path.replace(/^\//, "").split("/")[0] || "/";
    for (const [method, spec] of Object.entries(methods)) {
      (groups[resource] ??= []).push({ method: method.toUpperCase(), path, summary: spec.summary || "" });
    }
  }

  const order = Object.keys(groups).sort();
  let html = "";
  for (const resource of order) {
    html += `<h3>${resource}</h3><table><thead><tr><th>Method</th><th>Path</th><th>Description</th></tr></thead><tbody>`;
    for (const { method, path, summary } of groups[resource]) {
      html += `<tr><td><span class="api-method api-method-${method.toLowerCase()}">${method}</span></td>` +
              `<td><code>${path}</code></td><td>${summary}</td></tr>`;
    }
    html += "</tbody></table>";
  }
  target.innerHTML = html || "<p><em>No paths in the schema.</em></p>";
})();
</script>

## Current shape, at a glance

Every entity (`sites`, `labs`, `zones`, `stations`, `modules`, `devices`)
follows the same five-route shape: list (paginated, `limit`/`offset` +
`X-Total-Count`), get-one (by UUID or unique `name`), create, partial update
(`PATCH`, only sent fields change — no `PUT`), delete. Plus `files`, a
polymorphic upload/list/download/delete over any entity above. No filtering
beyond pagination yet. See `PROJECT_HISTORY.md` for why (and what's still
missing — auth, revisions, CapabilityClass, Device's ophyd/transport fields)
and `project_plan/EPIChem_Roadmap.md` for what closes those gaps.
