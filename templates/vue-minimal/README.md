# Finesoft Front minimal application

Feed, detail and Notes demonstrate tabs/stacks, retained drafts, a per-application profile and session restoration. All three native frameworks have the same example.

## Run

Node must satisfy `^22.18.0 || >=24.11.0`. Use Vite+ for tooling.

```sh
vp install
vp run dev
vp run build
vp run preview
```

Visit `/`, open a Feed item, enter a detail note, switch to Notes and type a draft. Switch tabs and reload to see both drafts restored. Use Back to remove the detail entry; opening it again starts a fresh draft. Your name is global to this application and is saved on blur.

## Server controller example

`src/lib/controllers/detail.ts` extends `BaseServerController` from `@finesoft/front`. Open `/item/2` and inspect the response header `x-demo-request-method: GET`. Return to Feed and open another item: browser navigation loads the controller remotely using POST, whose response contains `x-demo-request-method: POST`. This demonstrates reading `context.request` and explicitly writing `context.responseHeaders` without adding an authentication policy.

SSR executes the controller directly, and hydration reuses the result. Its implementation stays on the server; `markPublic` selects the data sent to the native view. Home and Notes remain ordinary `BaseController` examples. Route types come from `src/app-definition.ts`; the Vite plugin maintains the generated `Input` type with the appropriate server context.

Keep the configured SSR entry and deploy to a request host such as Node or Worker. Serving only `dist/client` cannot execute this controller. Login state and any credential forwarding remain application-owned.

## Edit

- `src/config.ts`: application identity and persistence namespace.
- `src/app-definition.ts`: pages, routes, guards and navigation.
- `src/lib/controllers/` and `src/lib/models/`: page loading and typed public data.
- `src/pages/`, `src/App.*`, `src/styles.css`: native UI and presentation.
- `src/views.ts`: the view registry shared by browser and server.
- `src/main.ts` and `src/ssr.ts`: standard browser and SSR startup.

`src/instance.ts` creates one profile store/provider per mount. For an embedded application, call `mountApplication(target, uniquePersistenceKey, "memory", "/notes")`. The `data-restore-root` fields belong to their page entries.

`src/locales/` contains English and Chinese JSON messages. Set `frameworkConfig.locale` in `src/app-definition.ts` to `en-US` or `zh-Hans` (default), then restart/rebuild. Navigation labels and sample items remain English.

All framework APIs import from `@finesoft/front`. Select the native component with `Outlet("react")`, `Outlet("vue")`, or `Outlet("svelte")`, and pass the same renderer to `useSnapshot`. The plugin maintains `.finesoft/front.d.ts` and the exact TypeScript import mapping; install only the chosen renderer. For standalone TypeScript checks, first run `vp exec finesoft-types`. The project is standalone and requires no sibling templates or private runtime packages.
