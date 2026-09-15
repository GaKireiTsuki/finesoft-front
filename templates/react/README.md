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

## Edit

- `src/config.ts`: application identity and persistence namespace.
- `src/app-definition.ts`: pages, routes, guards and navigation.
- `src/lib/controllers/` and `src/lib/models/`: page loading and typed public data.
- `src/pages/`, `src/App.*`, `src/styles.css`: native UI and presentation.
- `src/views.ts`: the view registry shared by browser and server.
- `src/main.ts` and `src/ssr.ts`: standard browser and SSR startup.

Import portable APIs from `@finesoft/front`, page/navigation APIs from `@finesoft/front/web`, and browser startup from `@finesoft/front/browser`. Keep the selected native renderer entries. The project is standalone and requires no sibling templates or private runtime packages.
