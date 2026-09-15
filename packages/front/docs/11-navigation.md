# Structured navigation

Tabs, Stack and Split are immutable navigation declarations. Page references derive operation targets; branch and column names remain intentional layout identities.

## Tree / 导航树

```ts
import { stack, tabs, split } from "@finesoft/front/web";
import { home, product } from "./pages";
export const navigation = tabs({
    active: "catalog",
    branches: {
        catalog: stack([home.leaf(), product.leaf({ id: 42 })]),
        compare: split([{ id: "left", content: product.leaf({ id: 42 }) }, { id: "right" }]),
    },
});
// defineWebApp({ ..., navigation })
```

Each equal target still receives its own EntryId and draft. ResourceKey may share explicitly cached query data without sharing view state. Standard browser start owns URL actions, redirects and popstate; obsolete URL results cannot commit over later work. Explicit tree operations use one serialized controller queue. Tabs retain branches, Stack retains present entries, Split guards each destination. Choose renderer mode `entries` when native entry lifetimes should follow the tree.
