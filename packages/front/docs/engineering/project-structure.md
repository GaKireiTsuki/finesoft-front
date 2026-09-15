# Application structure

The React, Vue and Svelte templates have two consistent tiers. Each generated project is standalone and uses only the public package entries.

## Choose a tier

| Tier    | Pages and routes                                                          | Demonstrated behavior                                                                                        |
| ------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Full    | Home `/`, product `/products/:id`, search `/search?q=...`, About `/about` | SSR, CSR About, URL actions, typed parameters, DI, mapper/API client examples, authentication and SEO guards |
| Minimal | Feed `/`, detail `/item/:id`, Notes `/notes`                              | Tabs and stacks, entry drafts, global profile, session restoration, locale JSON and SSR hydration            |

Within a tier the three frameworks have the same routes, controller results, content and interactions. Full uses a root renderer; minimal uses an entries renderer with a separate application chrome. The names describe the example applications, not a ranking of framework capabilities.

## Files

```text
src/config.ts          # app identity / persistence namespace
src/app-definition.ts  # page definitions, routes, guards and optional navigation
src/views.ts           # native view registry shared by browser and SSR
src/main.ts            # standard browser startup and HMR disposal
src/ssr.ts             # selected standard SSR renderer
src/App.<native>       # full layout or minimal navigation/profile chrome
src/pages/             # native page components (.tsx / .vue / .svelte)
src/components/        # reusable full-template presentation components
src/lib/controllers/   # BaseController page loaders and explicit public data
src/lib/models/        # typed page/data contracts
src/styles.css         # identical styling within each tier
src/instance.ts        # minimal: a new profile store/provider per mount
src/locales/           # minimal: en-US and zh-Hans JSON messages
```

Full additionally keeps its product data, mapper, HTTP client and guards under `src/lib/`, and navigation actions in `src/actions.ts`. Minimal's renderer supplies committed navigation snapshots to chrome; only the profile store needs a native lifecycle subscription. The framework owns history, view readiness, entry lifetime and session restoration.

## Controllers and page declarations

All six templates use `BaseController`: classes in `lib/controllers/` implement business loading, while `app-definition.ts` registers factories with `definePage({ id, create: () => new HomeController() })` and reuses the returned `route()`, `leaf()` and `bindView()` references. `views.ts` binds native components, which receive the result through `page`.

Import the controller from `@finesoft/front`, and Web page types and `markPublic` from `@finesoft/front/web`. Controllers are created for actual execution; entry drafts and global profile state belong to page instances and the application store respectively. The `getErrorPage` factory creates error pages. See [routes, controllers and typed pages](../02-routing-and-controllers.md) for parameters, DI, `fallback` and function handlers.

## State and locale

In minimal, the detail input and Notes textarea live inside `data-restore-root`. Switching tabs retains both drafts; reloading restores them. Popping a detail entry destroys its draft. The profile is global to one mounted application and survives reload. `mountApplication(target, persistenceKey, "memory", "/notes")` allows an embedded application with a distinct persistence key.

All three minimal templates default to `zh-Hans`. Set `frameworkConfig.locale` in `src/app-definition.ts` to `en-US` or `zh-Hans` and restart/rebuild. The locale demonstration covers JSON loading and translation after hydration; the navigation labels and sample item data remain English.

Full's unauthenticated `/admin` route redirects to `/login?from=...`; the template deliberately leaves the application's real login page and authentication service to its author. A demo `auth_token` cookie lets the guard continue.

## Maintaining parity

Framework-neutral files are identical checked-in source in each same-tier project. Native imports, UI syntax, framework dependencies and app identities are the allowed differences. The projects need no sibling-template imports or private runtime aliases. The scaffolder packages these same source files and includes a local README.

Run `vp test packages/create-app/test` to check file/adapter parity, then build the six templates and run `vp exec node scripts/verify-template-renderers.mjs` for shared browser behavior. `vp exec node scripts/verify-created-consumers.mjs /absolute/path/to/front.tgz` prepares, installs and builds every generated project outside the workspace against the selected local package.

Optional independent data operations and Node/Worker hosts can be added in separate `src/data-app.ts`, `src/node.ts` and `src/worker.ts` modules. They share application contracts through the public entries.
