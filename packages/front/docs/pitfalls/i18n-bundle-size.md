# Locale bundle size

A static import of every locale adds those messages to the browser bundle. Use the generated locale loader at the application definition boundary.

## Loader / 加载器

```ts
import { loadMessages } from "virtual:finesoft-front/i18n-loader";
// defineWebApp({ ..., loadMessages })
```

Inspect production chunks and gzip totals using identical routes and build settings. A smaller entry file alone may only move bytes into another chunk. SSR and client locale must agree before hydration.
