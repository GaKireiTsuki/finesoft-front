# Pitfall: i18n bundle size

## Symptom

Lighthouse complains about a large initial JS payload. Network panel shows a huge chunk on first request. Your `dist/client/assets/index-*.js` is bigger than it should be, and `vp build --analyze` shows the messages folder dominating the bundle.

## Root cause

Translations got bundled into the main client chunk instead of being split per locale. Either:

- You imported `src/locales/*.json` directly at module top:

    ```ts
    import zh from "../locales/zh-Hans.json";
    import en from "../locales/en-US.json";
    import ja from "../locales/ja-JP.json";
    ```

    All three locales now live in every user's bundle, even though each user only sees one.

- You built a `Translator` with all messages inlined at module top:

    ```ts
    const t = new SimpleTranslator({
        locale: "en-US",
        messages: { ...zhMessages, ...enMessages, ...jaMessages },
    });
    ```

- You serialized translations into HTML via `serializeServerData`, so every SSR page response includes the full dictionary.

## Fix

### Use `messagesDir` instead of static imports

Configure the Vite plugin:

```ts
finesoftFrontViteConfig({
    i18n: { messagesDir: "src/locales" },
});
```

The plugin generates a per-locale loader. On the server it reads from disk; on the browser it dynamic-imports the appropriate chunk. Vite splits each locale's JSON into its own chunk, and only the chunk matching the resolved locale is fetched.

```
dist/client/assets/
├── index-abc123.js       ← main bundle (no translations)
├── locale-en-US-def456.js ← only loaded for en-US visitors
├── locale-zh-Hans-789.js  ← only loaded for zh-Hans visitors
└── locale-ja-JP-xyz.js    ← only loaded for ja-JP visitors
```

### Don't serialize translations into HTML

The framework deliberately does **not** include the dictionary in `PrefetchedIntents`. The browser fetches its locale chunk in parallel with the initial render.

If you've been manually injecting translations into the page via your own mechanism, stop:

```html
<!-- BAD — every SSR response carries the dictionary -->
<script>
    window.__TRANSLATIONS__ = { hello: "你好" /* hundreds of keys */ };
</script>
```

```ts
// GOOD — the framework loads it as a separate chunk
// (handled automatically when you use messagesDir)
```

### Check what's actually shipping

```bash
vp build
ls -lah dist/client/assets/locale-*
ls -lah dist/client/assets/index-*
```

The index chunk should not change when you add a new locale's JSON. If it does, something's wrong.

For a visual breakdown:

```bash
vp build --analyze
```

This opens an interactive treemap of bundle contents. Locale chunks should be small (KB), separate, and named.

## How big is "too big"?

Rough thresholds for first-paint critical JS (the index chunk):

- Static marketing site: <50 KB gzipped
- Standard SPA: <150 KB gzipped
- Heavy dashboard: <300 KB gzipped

If translations push your index chunk past these, separate them. Per-locale chunks of 10-50 KB are normal and shouldn't worry you.

## Server-side: the dictionary is cached, not bundled

On the server, the framework reads the locale JSON from disk on first request and caches it for subsequent requests:

```
Request 1 (zh-Hans): disk read of zh-Hans.json, cached
Request 2 (zh-Hans): served from cache
Request 3 (en-US):   disk read of en-US.json, cached
```

You don't ship a huge SSR bundle either — `tsdown` packages your server entry, but the locale JSONs are read from disk at runtime, not embedded.

This means:

- ✅ Cold-start cost: one disk read per locale, once per worker
- ✅ Steady-state: zero overhead — locales sit in a `Map`
- ❌ Mutability: edit a JSON, server keeps the cached old version until restart

The mutability issue isn't usually a problem because you commit translations to source control and a redeploy reloads them. For runtime-updated translations, use the custom `loadMessages` callback to fetch from a service.

## What if my dictionary is genuinely huge?

If a single locale's dictionary is multiple MB (rare — most apps fit in <100 KB):

### Split by namespace

```
src/locales/
├── en-US/
│   ├── common.json
│   ├── checkout.json
│   ├── admin.json
│   └── help-center.json
└── zh-Hans/
    └── ...
```

Build a custom `loadMessages` that loads only the namespaces a given page needs:

```ts
createSSRRender({
    bootstrap,
    async loadMessages(locale) {
        // load only "common" eagerly; lazy-load others on demand
        return import(`./locales/${locale}/common.json`);
    },
    async renderApp(page) {
        /* ... */
    },
});
```

The view layer can then call `await translator.loadNamespace("admin")` before rendering admin-specific strings.

### Lazy-load on view mount

For very large optional dictionaries (help content, error code messages), fetch them on demand from the view layer rather than at framework startup. The framework doesn't need to know about them — they're just data.

## Network-side optimization

Even with proper splitting, you can speed up the locale fetch:

- Set long `Cache-Control` on locale chunks (Vite's content-hash filenames make this safe)
- Preload the user's locale chunk:
    ```html
    <link rel="preload" href="/assets/locale-en-US-def456.js" as="script" crossorigin />
    ```
- For high-traffic apps, push the locale chunk over the same HTTP/2 connection as the main JS

## Why not just put translations in the HTML?

Because:

- Every page response ships the entire dictionary — including content for pages the user never visits
- HTML can't be cached at the CDN level when it varies by locale and contains the dictionary
- SSR latency increases linearly with dictionary size

The per-locale chunk is the right tradeoff: shipped once, cached forever, only for the locale the user actually has.

## Related

- [Chapter 5: i18n](../05-i18n.md) — the full picture of locale handling
- The Vite plugin source: `packages/server/src/vite-plugin.ts` (search for `messagesDir`)
