# Self-hosted fonts

`DESIGN.md` §3 requires Roboto **self-hosted**: loading it from
`fonts.googleapis.com` sends the visitor's IP to Google and needs consent under GDPR, so the app
must never link the CDN. It doesn't — `src/styles/tokens.css` only names the family and falls back
to `system-ui`, then Arial (DESIGN.md's own stated fallback).

To get real Roboto:

1. Download the family from <https://fonts.google.com/specimen/Roboto> (Apache-2.0) and put the
   `.woff2` files here, e.g. `roboto-300.woff2`, `roboto-400.woff2`, `roboto-700.woff2`.
2. Add the `@font-face` rules to the top of `src/styles/tokens.css`:

   ```css
   @font-face {
     font-family: "Roboto";
     src: url("/fonts/roboto-400.woff2") format("woff2");
     font-weight: 400;
     font-display: swap;
   }
   /* …and one block per weight you shipped (300, 700). */
   ```

Nothing else changes — `--font-display` / `--font-body` already ask for "Roboto" first.

Merriweather (DESIGN.md's editorial face) is deliberately not used here: §3 scopes it to
narrative/editorial screens, not tool UI.
