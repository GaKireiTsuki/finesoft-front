# Features, platform and PWA

Portable detection and feature contracts belong to the root entry. Browser-only PWA and DOM behavior belongs to the browser entry.

## Imports / 入口

```ts
import { detectPlatform, type FeatureFlagsProvider } from "@finesoft/front";
import { getPWADisplayMode } from "@finesoft/front/browser";
// Configure configuration.featureFlags and configuration.platform in the Web declaration.
// Call getPWADisplayMode only in a browser-owned lifecycle.
```

Feature flags are application decisions, not authentication. Enforce protected operations with runtime policies. A service worker manifest/caching strategy remains application work; selecting the browser host does not install one.
