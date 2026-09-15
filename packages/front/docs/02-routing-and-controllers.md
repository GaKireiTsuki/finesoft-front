# Routes and typed pages

Declare a page once and reuse its reference for routes and navigation targets. Factories create a fresh controller for each execution.

## Page / 页面

```ts
import { definePage, defineWebApp, markPublic } from "@finesoft/front/web";
export const home = definePage({
    id: "load-home",
    handler: () => markPublic({ id: "home", pageType: "home" as const, title: "Home" }, []),
});
export const app = defineWebApp({
    id: "example",
    controllers: [home],
    routes: [home.route("/")],
    getErrorPage: (status, message) => ({ id: String(status), pageType: "error", title: message }),
});
```

## Typed target / 类型化目标

```ts
import { definePage } from "@finesoft/front/web";
import { int } from "@finesoft/front";
export const product = definePage({
    id: "load-product",
    handler: (params: { id: number }) => ({
        id: String(params.id),
        pageType: "product" as const,
        title: "Product " + params.id,
    }),
});
export const productRoute = product.route("/products/:id", { params: { id: int() } });
export const target = product.leaf({ id: 42 });
```

`id` is operation identity; `pageType` selects a renderer view; every leaf receives a fresh EntryId. `bindView` validates literal result page types, without inferring one from the operation id. Widened `BasePage.pageType: string` cannot provide that check. Typed leaf parameters retain handler/controller types; route codecs still explicitly decode external input. A route codec is not automatically proven equivalent to an arbitrary handler schema. `BaseController` remains optional and its default fallback rethrows.

<Ch02RouteResolver />
