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

## Edit

- `src/config.ts`: application identity and persistence namespace.
- `src/app-definition.ts`: pages, routes, guards and navigation.
- `src/lib/controllers/` and `src/lib/models/`: page loading and typed public data.
- `src/pages/`, `src/App.*`, `src/styles.css`: native UI and presentation.
- `src/views.ts`: the view registry shared by browser and server.
- `src/main.ts` and `src/ssr.ts`: standard browser and SSR startup.

`src/instance.ts` creates one profile store/provider per mount. For an embedded application, call `mountApplication(target, uniquePersistenceKey, "memory", "/notes")`. The `data-restore-root` fields belong to their page entries.

`src/locales/` contains English and Chinese JSON messages. Set `frameworkConfig.locale` in `src/app-definition.ts` to `en-US` or `zh-Hans` (default), then restart/rebuild. Navigation labels and sample items remain English.

Import portable APIs from `@finesoft/front`, page/navigation APIs from `@finesoft/front/web`, and browser startup from `@finesoft/front/browser`. Keep the selected native renderer entries. The project is standalone and requires no sibling templates or private runtime packages.
