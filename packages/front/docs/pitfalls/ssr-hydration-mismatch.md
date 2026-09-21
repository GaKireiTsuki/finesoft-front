# Hydration mismatch

Share the same page definition, App and Outlet view registry between browser and SSR. Use `createSSRRender({ definition, render: app => nativeRender(app) })` on the server. In the browser, select native hydrate or mount using `app.shouldHydrate`, mount first, then await `app.ready`.

Hydrate the server snapshot before restoring persisted state. Avoid random values, time or browser globals during the first render. Do not await ready before mounting or manually mutate Outlet's child tree.

Declare explicit public projections; nested data needs a nested declaration or codec. Wire/buildId mismatches trigger fresh loading. Inspect browser warnings, DOM, requests and entry identity when diagnosing a mismatch.

Declare the site's locale in `defineWebApp({ configuration: { locale: "en" }, ... })` so SSR and the browser use the same value. The SSR assembler writes `lang` and `dir` on `<html>`. The browser also scopes those attributes to the selected app target, together with `data-fs-app`, so embedded applications can retain their own locale without changing the containing document. A static `<html lang="en">` alone does not configure the server runtime's locale.

`injectSSRContent` also stamps a compact fingerprint of the data script's parent container. `createBrowserApp` compares that fingerprint immediately before returning the native mount handle, after consuming valid SSR data. This detects changed attributes, text, comments and structure without identifying browser extensions. The comparison follows parsed HTML rather than raw HTML strings; custom element hosts and their contents are opaque to this check. Root attributes and nodes outside the app are outside its scope.

When the DOM changed and replacement is safe, `shouldHydrate` is false: the existing React/Vue/Svelte template mounts a fresh native root using the SSR page data. It does not restart the page controller. The host logs `source: "hydration", code: "dom-changed", recovery: "native-mount"`. No plugin rules, global console filters or repeated recovery loop are installed. Normal markup continues to hydrate, and SPA navigation does not repeat the check.

The host keeps native hydration when it detects existing focus, selection, edited controls, scrolling, editable content, active media, custom elements, nested apps or opaque browser contexts. That path logs `recovery: "deferred"`; native warnings and native hydration behavior remain in effect. It avoids an additional destructive remount, but cannot guarantee preservation if the native renderer itself fails hydration. Manually assembled HTML without a fingerprint, or a data script outside the selected target, retains the usual native hydration behavior.

This is a startup recovery boundary, not extension isolation or a security check. A changed fingerprint does not identify the cause: an extension, application script or HTML rewriter can all modify DOM. Head styles, opaque component internals, changes after inspection and errors in an extension's own execution context are not repaired. Native mismatches with an unchanged server DOM are still reported normally.
