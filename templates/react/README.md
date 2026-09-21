# Finesoft Front full application

Home, product detail, search and About demonstrate SSR, CSR, URL actions, typed route parameters, DI, data mapping and guards. All three native frameworks have the same example.

## Run

Node must satisfy `^22.18.0 || >=24.11.0`. Use Vite+ for tooling.

```sh
vp install
vp run dev
vp run build
vp run preview
```

Visit `/`, open a product, try `/search?q=Vite`, and navigate to `/about` (CSR). `/admin` demonstrates an authentication guard: without an `auth_token` cookie it redirects to `/login?from=...`. Add your real login page and authentication service when adopting this example.

## Server controller example

`src/lib/controllers/product-detail.ts` extends `BaseServerController` from `@finesoft/front`. Open `/products/1`, then navigate to another product. The controller reads the incoming `last_product` cookie and explicitly writes a new HttpOnly cookie when the product changes. It also sets `Cache-Control: private, no-store`. This is an application-owned browsing preference; the framework provides request/response tools and does not manage login state or automatically forward credentials.

SSR executes the controller directly. Browser navigation invokes it on the server, and hydration reuses the SSR result. Its implementation stays out of the browser bundle; `markPublic` selects the page data sent to the browser. Home, search and About keep ordinary `BaseController` examples. Route types still come from `src/app-definition.ts`; the Vite plugin maintains the generated `Input` / `Failure` types and provides the server context automatically.

Keep the configured SSR entry and deploy to a request host such as Node or Worker. Serving only `dist/client` cannot execute this controller. The template runs locally without external API credentials.

## Edit

- `src/config.ts`: application identity and persistence namespace.
- `src/app-definition.ts`: pages, routes, guards and navigation.
- `src/lib/controllers/` and `src/lib/models/`: page loading and typed public data.
- `src/pages/`, `src/App.*`, `src/styles.css`: native UI and presentation.
- `src/views.ts`: the view registry shared by browser and server.
- `src/main.ts` and `src/ssr.ts`: standard browser and SSR startup.

All framework APIs import from `@finesoft/front`. Select the native component with `Outlet("react")`, `Outlet("vue")`, or `Outlet("svelte")`, and pass the same renderer to `useSnapshot`. The plugin maintains `.finesoft/front.d.ts` and the exact TypeScript import mapping; install only the chosen renderer. For standalone TypeScript checks, first run `vp exec finesoft-types`. The project is standalone and requires no sibling templates or private runtime packages.
