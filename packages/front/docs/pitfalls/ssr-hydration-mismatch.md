# Hydration mismatch

Share the same page definition, App and Outlet view registry between browser and SSR. Use `createSSRRender({ definition, render: app => nativeRender(app) })` on the server. In the browser, select native hydrate or mount using `app.hydrate`, mount first, then await `app.ready`.

Hydrate the server snapshot before restoring persisted state. Avoid random values, time or browser globals during the first render. Do not await ready before mounting or manually mutate Outlet's child tree.

Declare explicit public projections; nested data needs a nested declaration or codec. Wire/buildId mismatches trigger fresh loading. Inspect browser warnings, DOM, requests and entry identity when diagnosing a mismatch.
