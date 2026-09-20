import {
    BaseController,
    int,
    list,
    makeSchema,
    oneOf,
    optional,
    str,
    withDefault,
    type ControllerInput,
} from "@finesoft/core";
import type { ExecutionContext } from "@finesoft/core";
import { definePage } from "../../src/application/page";
import { defineWebApp } from "../../src/application/definition";
import { createWebRuntime } from "../../src/application/runtime";
import { createWebSession } from "../../src/application/session";
import type { WebAppView, ViewProps } from "../../src/application/view";
import { stack } from "../../src/navigation/nodes";
import { route, type PageRoute } from "../../src/bootstrap/define-routes";

declare function expectType<T>(value: T): void;
const result = { id: "item", pageType: "item" as const, title: "Item" };
const item = definePage({
    id: "item",
    routes: [
        {
            path: "/items/:id",
            params: { id: int() },
            query: {
                tags: list(str()),
                sort: optional(oneOf(["asc", "desc"])),
                page: withDefault(int(), 1),
            },
        },
        {
            path: "/products/:id",
            params: { id: int() },
            query: {
                tags: list(str()),
                sort: optional(oneOf(["asc", "desc"])),
                page: withDefault(int(), 1),
            },
        },
    ],
    handler(params, context, query) {
        expectType<number>(params.id);
        expectType<string[]>(query.tags);
        expectType<"asc" | "desc" | undefined>(query.sort);
        expectType<number>(query.page);
        expectType<ExecutionContext>(context);
        // @ts-expect-error route codecs infer number rather than any
        params.id.toUpperCase();
        return result;
    },
});
expectType<"item">(item.id);
item.leaf({ id: 42 }, { query: { tags: [], page: 1 } });
// @ts-expect-error decoded id is numeric
item.leaf({ id: "42" }, { query: { tags: [], page: 1 } });
// @ts-expect-error required id cannot be omitted
item.leaf({}, { query: { tags: [], page: 1 } });

const controller = definePage({
    id: "controller",
    routes: [{ path: "/controller/:id", params: { id: int() } }],
    create: () => ({
        perform(params, context) {
            expectType<number>(params.id);
            expectType<ExecutionContext>(context);
            // @ts-expect-error contextual controller parameters are not any
            params.id.toUpperCase();
            return result;
        },
    }),
});
controller.leaf({ id: 42 });
controller.bindView("item", {});
// @ts-expect-error factory result pageType inference is preserved
controller.bindView("wrong", {});
// @ts-expect-error inferred controller input reaches the reference
controller.leaf({ id: "42" });

// @ts-expect-error execute/fallback objects are not Controller factories; use BaseController
definePage({ id: "inline", routes: ["/inline"], create: () => ({ execute: () => result }) });

const query = definePage({
    id: "query",
    routes: [
        {
            path: "/query",
            query: {
                ids: optional(list(int())),
                tags: withDefault(list(str()), ["all"]),
            },
        },
    ],
    handler(_params, _context, query) {
        expectType<number[] | undefined>(query.ids);
        expectType<string[]>(query.tags);
        return result;
    },
});
query.leaf({}, { query: { tags: [] } });
query.leaf({}, { query: { tags: ["a"], ids: [1, 2] } });
// @ts-expect-error multi-value query preserves element types
query.leaf({}, { query: { tags: [], ids: ["1"] } });
// @ts-expect-error defaulted query is present in decoded controller input
query.leaf({});

const plain = definePage({
    id: "plain",
    routes: ["/plain/:id/:tab?", "/alias/:id/:tab?"],
    handler(params) {
        expectType<string>(params.id);
        expectType<string | undefined>(params.tab);
        // @ts-expect-error string shorthand does not imply numeric conversion
        params.id.toFixed();
        return result;
    },
});
plain.leaf({ id: "42" });
const union = definePage({
    id: "union",
    routes: [{ path: "/by-id/:id", params: { id: int() } }, "/by-name/:name"],
    handler(params) {
        if ("id" in params) expectType<number>(params.id);
        else expectType<string>(params.name);
        // @ts-expect-error not every route supplies id
        params.id.toFixed();
        return result;
    },
});
union.leaf({ id: 1 });
union.leaf({ name: "book" });

definePage({
    id: "async",
    routes: [
        {
            path: "/async/:id?",
            params: { id: optional(int()) },
            query: { enabled: makeSchema(async () => ({ value: true })) },
        },
    ],
    handler(params, _context, query) {
        expectType<number | undefined>(params.id);
        expectType<boolean>(query.enabled);
        return result;
    },
});
definePage({
    id: "typo",
    // @ts-expect-error codec key does not occur in the path
    routes: [{ path: "/typo/:id", params: { id: int(), typo: str() } }],
    handler: () => result,
});

class TypedController extends BaseController<ControllerInput<{ id: number }>, typeof result> {
    execute({ params }: { params: { id: number } }) {
        expectType<number>(params.id);
        return result;
    }
}
const typedControllerPage = definePage({ id: "typed", create: () => new TypedController() });
typedControllerPage.leaf({ id: 1 });
definePage({
    id: "typed-route",
    routes: [{ path: "/typed/:id", params: { id: int() } }],
    create: () => new TypedController(),
});
// @ts-expect-error a numeric-only controller cannot receive a plain string path parameter
definePage({ id: "mismatch", routes: ["/mismatch/:id"], create: () => new TypedController() });

definePage({
    id: "union-mismatch",
    // @ts-expect-error the controller must accept every alias, including the string input
    routes: [{ path: "/numeric/:id", params: { id: int() } }, "/string/:id"],
    create: () => new TypedController(),
});
definePage({
    id: "optional-mismatch",
    // @ts-expect-error the controller cannot require an optional parameter
    routes: [{ path: "/optional/:id?", params: { id: optional(int()) } }],
    create: () => new TypedController(),
});

const reusedRoute = route("/reused/:id", {
    intentId: "reused",
    params: { id: int() },
    query: { name: str() },
});
const reused = definePage({
    id: "reused",
    routes: [reusedRoute],
    handler(params, _context, query) {
        expectType<number>(params.id);
        expectType<string>(query.name);
        return result;
    },
});
reused.leaf({ id: 42 }, { query: { name: "book" } });
// @ts-expect-error reusable declarations retain numeric codecs
reused.leaf({ id: "42" });
definePage({
    id: "reference-route",
    routes: [reused.route("/reference/:id", { params: { id: int() }, query: { name: str() } })],
    handler(params, _context, query) {
        expectType<number>(params.id);
        expectType<string>(query.name);
        return result;
    },
});
definePage({
    id: "plain-reference-route",
    routes: [
        reused.route("/reference-plain/:id"),
        route("/plain-helper/:id", { intentId: "plain" }),
    ],
    handler(params) {
        expectType<string>(params.id);
        return result;
    },
});
declare const optionalCodecs: PageRoute<"/optional-codecs/:id", { id: ReturnType<typeof int> }>;
definePage({
    id: "optional-codecs",
    routes: [optionalCodecs],
    handler(params) {
        // @ts-expect-error an optional codec map cannot promise the raw string representation
        expectType<string>(params.id);
        // @ts-expect-error it also cannot promise that the codec was provided
        expectType<number>(params.id);
        return result;
    },
});

const definition = defineWebApp({
    id: "typed",
    pages: [item, controller, plain, union],
    getErrorPage: (_status, title) => ({ ...result, title }),
});
const session = createWebSession({
    web: createWebRuntime({ definition }),
    initial: stack(plain.leaf({ id: "1" })),
});
void session.perform({
    kind: "push",
    intent: "item",
    params: { id: 42 },
    query: { tags: [], page: 1 },
});
void session.perform({
    kind: "push",
    intent: "item",
    // @ts-expect-error app preserves numeric input from the route
    params: { id: "42" },
    query: { tags: [], page: 1 },
});
// @ts-expect-error required params cannot be omitted
void session.perform({ kind: "push", intent: "item" });
// @ts-expect-error known application ids are exhaustive
void session.perform({ kind: "push", intent: "missing", params: {} });
void session.perform({ kind: "selectColumn", columnId: "detail", intent: undefined });
void session.perform({
    kind: "selectColumn",
    columnId: "detail",
    intent: "controller",
    // @ts-expect-error column destinations retain their parameter contract
    params: { id: "42" },
});
void session.perform({
    kind: "compound",
    // @ts-expect-error compound children use the same application contract
    actions: [{ kind: "replaceTop", intent: "controller", params: { id: "42" } }],
});
const general: WebAppView = session;
const typed: WebAppView<typeof definition> = session;
declare const props: ViewProps<typeof result, typeof definition>;
// @ts-expect-error native page props retain typed actions when associated with the definition
void props.app.perform({ kind: "push", intent: "plain", params: { id: 42 } });
void [general, typed];

definePage({
    id: "query-separate",
    routes: [{ path: "/query/:id", params: { id: int() }, query: { id: str() } }],
    handler(params, _context, query) {
        expectType<number>(params.id);
        expectType<string>(query.id);
        return result;
    },
});
definePage({
    id: "invalid-codec",
    // @ts-expect-error codecs must implement Standard Schema
    routes: [{ path: "/codec/:id", params: { id: 42 } }],
    handler: () => result,
});
const other = definePage({ id: "other", routes: ["/other/:id"], handler: () => result });
declare const otherApp: WebAppView<ReturnType<typeof otherDefinition>>;
function otherDefinition() {
    return defineWebApp({ id: "other-app", pages: [other], getErrorPage: () => result });
}
// @ts-expect-error application parameter maps are isolated
void otherApp.perform({ kind: "push", intent: "item", params: { id: "42" } });
