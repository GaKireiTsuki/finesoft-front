# 10. Features, platform, PWA

Three small, independent runtime helpers:

- **Feature flags** — config that can change without redeploy
- **Platform detection** — user-agent parsing for OS / browser / engine
- **PWA mode** — detect whether the app is installed (standalone)

Each is replaceable, each composable with custom providers.

## Feature flags

```ts
const framework = Framework.create({
    featureFlags: {
        darkMode: true,
        maxRetries: 3,
        experimentalCheckout: false,
    },
});

const flags = framework.container.resolve(DEP_KEYS.FEATURE_FLAGS);
flags.get("darkMode"); // true
flags.get("maxRetries"); // 3
flags.get("missing"); // undefined
flags.get("missing", "fallback"); // "fallback"
```

Flags can be any JSON-serializable value: booleans, strings, numbers, arrays, objects.

### Static config

The simplest case — flags shipped with the bundle:

```ts
Framework.create({
    featureFlags: {
        darkMode: process.env.NODE_ENV !== "production",
        analytics: true,
        cdnUrl: "https://cdn.example.com",
    },
});
```

Use this for flags driven by environment, not user attributes.

### Remote providers

Plug in a provider that fetches from a remote service (LaunchDarkly, GrowthBook, Unleash, your own config service):

```ts
import { type FeatureFlagsProvider } from "@finesoft/front";

const remoteConfigProvider: FeatureFlagsProvider = {
    async load() {
        const resp = await fetch("https://config.example.com/flags");
        return resp.json(); // { ...flags }
    },
};

const framework = Framework.create({
    featureFlags: {
        darkMode: false,
        maxRetries: 3,
    },
    featureFlagsProviders: [remoteConfigProvider],
});
```

Providers run in registration order. Later providers override earlier values for the same key — "last registered wins."

### Cache lifecycle

The framework loads provider values once during `Framework.create()`. After that, flags are read synchronously from memory.

To refresh, call `flags.refresh()`:

```ts
const flags = framework.container.resolve(DEP_KEYS.FEATURE_FLAGS);
await flags.refresh(); // re-runs all providers
```

You'd typically call this on a timer or in response to a server-sent event.

### Targeting

Built-in flags are global (same value for every user). For per-user targeting, structure your provider to return a function or use a separate evaluation step:

```ts
class TargetingProvider implements FeatureFlagsProvider {
    constructor(private userId: string) {}
    async load() {
        const resp = await fetch(`https://config.example.com/flags?userId=${this.userId}`);
        return resp.json();
    }
}

// Register per-request in a beforeLoad guard:
async function flagsGuard(ctx) {
    const userId = await getUserIdFromCookie(ctx);
    const targeting = new TargetingProvider(userId);
    const flags = await targeting.load();
    ctx.container.register(DEP_KEYS.FEATURE_FLAGS, () => ({
        get: (key, fallback) => flags[key] ?? fallback,
    }));
    return next();
}
```

For complex bucketing, hand the user id to a dedicated service (GrowthBook SDK, etc.) and store its evaluator in DI.

### SSR / CSR consistency

Flags evaluated on the server and not re-evaluated on the browser would cause hydration mismatch. The framework serializes flag values into `PrefetchedIntents` if a controller reads them. Browser-side reads return the same value the server saw.

For flags that _should_ differ (e.g., A/B variants), evaluate them in a `beforeLoad` guard and store the result in the request scope — both server and browser will use the value resolved by the server.

## Platform detection

```ts
import { detectPlatform } from "@finesoft/front";

const info = detectPlatform();
// {
//   os: "ios" | "android" | "macos" | "windows" | "linux" | "other",
//   browser: "safari" | "chrome" | "firefox" | "edge" | ...,
//   engine: "webkit" | "blink" | "gecko" | "other",
//   isMobile: boolean,
//   isTouch: boolean,
//   isServer: boolean,
// }
```

In the browser, `detectPlatform()` reads `navigator.userAgent`. On the server, parsing the request's `User-Agent` header is automatic via the framework:

```ts
const platform = framework.getPlatform();
```

For controllers and guards, resolve from DI:

```ts
const platform = ctx.container.resolve(DEP_KEYS.PLATFORM);
if (platform.isMobile) {
    return rewrite("/m" + ctx.url.pathname);
}
```

### Reliability

User-Agent strings lie — every modern browser embeds substrings of every other browser for compatibility. The framework's detection prioritizes well-known patterns and falls back to `"other"` on ambiguity. Don't make critical decisions on `browser` alone:

- ✅ Adjust layout for `isMobile`
- ✅ Hide Safari-only features for non-WebKit
- ❌ Lock specific browsers out
- ❌ Choose code paths based on browser version

## PWA detection

```ts
import { getPWADisplayMode } from "@finesoft/front";

const mode = getPWADisplayMode();
// "standalone" | "twa" | "browser"
```

- `"standalone"` — running as an installed PWA (Safari add-to-home, Chrome install)
- `"twa"` — Trusted Web Activity (Android, wrapped as a native app)
- `"browser"` — regular browser tab

The function reads `window.matchMedia("(display-mode: standalone)")` and Android's TWA referrer. Server-side: returns `"browser"`.

### Common uses

```ts
const mode = getPWADisplayMode();

if (mode === "browser") {
    showInstallBanner();
}

if (mode === "standalone") {
    // Customize navigation — installed app shouldn't show "Install" prompt
    hideInstallButton();
    enableNativeBackButtonHandling();
}
```

### Service worker registration

PWA install is independent of service workers — you can have one without the other. To register a service worker:

```ts
// src/main.ts
startBrowserApp({
    bootstrap,
    mount,
    onAfterStart() {
        if ("serviceWorker" in navigator) {
            navigator.serviceWorker.register("/sw.js");
        }
    },
});
```

The framework does not ship a service worker generator. Use [Vite PWA](https://vite-pwa-org.netlify.app/) or hand-roll one.

## Composing them

A common navigation guard combining all three:

```ts
import { next, rewrite, DEP_KEYS } from "@finesoft/front";

function mobilePwaGuard(ctx) {
    const platform = ctx.container.resolve(DEP_KEYS.PLATFORM);
    const flags = ctx.container.resolve(DEP_KEYS.FEATURE_FLAGS);

    if (flags.get("mobilePwaRedesign") && platform.isMobile && !ctx.isSsr) {
        if (getPWADisplayMode() === "standalone") {
            return rewrite(`/pwa${ctx.url.pathname}`);
        }
    }
    return next();
}
```

This routes installed mobile PWA users to a different page tree without affecting other users.

## Caveats

- **Feature flags resolved server-side ship in HTML.** Don't store secrets in flags.
- **Platform detection on the server uses request headers.** A bot or curl might not send a useful User-Agent — handle `"other"` gracefully.
- **PWA detection on the server always returns `"browser"`.** Don't rely on it in SSR rendering paths; conditional UI based on PWA mode should be client-only or use `<noscript>` fallbacks.

## Next

- [Engineering: project structure](./engineering/project-structure.md) — where to put flag config, platform-aware code
