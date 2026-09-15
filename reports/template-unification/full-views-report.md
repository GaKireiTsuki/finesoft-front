# Full native views

## Changed files

- `templates/{react,vue,svelte}/src/App.*`, `components/*`, and `pages/*` now use the same full-page structure and receive `page`, optional `loading`, and optional `onAction` props.
- The three `src/styles.css` files are byte-identical and replace native inline/scoped styling for navigation, loading, product cards, shelves, search results, and prices.
- `Navigation` reads `NAV_LINKS`; return links use `NAV_ACTIONS.home`. Link handlers call `onAction` only for an ordinary unmodified primary click, retaining the native `href` path otherwise.
- Vue no longer accepts its legacy `state` fallback. Svelte no longer uses context; `templates/svelte/src/lib/framework-svelte.ts` was deleted.
- Vue and Svelte `PageRenderer` components now use explicit discriminated branches; no dynamic component registry remains.

## Validation

- `vp build` in `templates/react`: passed (client and SSR bundles).
- `vp build` in `templates/vue`: passed (client and SSR bundles).
- `vp build` in `templates/svelte`: passed (client and SSR bundles).
- `cmp` verified all three full-template `src/styles.css` files are identical.
- `git diff --check` passed for the owned view files. A source scan found no `/browser` imports in the native view files and no remaining Svelte framework-context references.

## Concern

The builds prove compilation and SSR bundling. Shared browser acceptance, including history and modified-click behavior in a real browser, remains owned by the integration task.

## Vue navigation follow-up

- Fixed `Navigation.vue`: Vue now calls `handleClick(link.action, $event)` directly. The former expression returned an event handler without invoking it, so the browser followed the anchor as a document navigation.
- Reviewed the other owned Vue click bindings. `ProductCard`, `NotFound`, and `ProductDetail` each pass their event directly to a handler and did not have this wrapper-return pattern.
- Re-ran `vp build` in `templates/vue`: passed (client and SSR bundles).
- Production preview at `http://127.0.0.1:5207` was checked in a real browser. After assigning `window.__templateDocument = "retained"`, clicking About produced `/about` with the About page and the marker still equal to `"retained"`, proving the navigation remained in the current document.
