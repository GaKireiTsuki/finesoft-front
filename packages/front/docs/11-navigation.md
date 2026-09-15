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

## Transaction policies

`defineWebApp({ beforeNavigate, beforeCommit })` adds optional whole-tree policies. Each policy in its array runs once per transaction, even when the target tree is empty. Definition policies run before controller-local policies. `beforeLoad` / `afterLoad` still run for each visible page.

```ts
import { next, deny, type BeforeCommitPolicy } from "@finesoft/front/web";
import { hasUnsavedDraft } from "./editor-state";
export const preserveDraft: BeforeCommitPolicy = ({ from, candidate }) => {
    // Inspect application-owned draft state and both trees here.
    const leavingEditor =
        from.destinations.some((page) => page.intent === "editor") &&
        !candidate.destinations.some((page) => page.intent === "editor");
    return leavingEditor && hasUnsavedDraft()
        ? deny(409, "Save your draft before leaving")
        : next();
};
// defineWebApp({ ..., beforeCommit: [preserveDraft] })
```

Admission receives `from`, candidate `tree`, stable `transitionId`, active `execution`, its `signal`, and `isServer`. It returns `next`, `deny`, or `redirect`. Page redirects keep the same transaction identity and do not repeat admission. Commit policies also receive the loaded `candidate`; they return only `next` or `deny`, before cache consumption, committed state, history, events or views change. Each redirect hop retains its existing execution cleanup; the final commit policy sees the final hop's execution. Async policies must honor cancellation for their own I/O; stale results cannot commit.

A denial returns an uncommitted snapshot with `rejection`, including for empty trees. Session restore rejects it before replacing scopes or slices. Initial browser denial renders the error without committing navigation or recording a page visit; later denial preserves the displayed draft. Both flat and navigation SSR honor these policies and emit no rejected page data or public-cache permission. CSR shells still defer navigation to the browser.

Owned back/forward rejection compensates to the committed history entry and restores its scroll identity. Additive history metadata preserves ownership and position across reloads. Entries without compatible ownership metadata are diagnosed; the framework cannot infer a safe traversal distance for external entries.
