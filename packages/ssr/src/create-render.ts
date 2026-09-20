import {
    createWebRuntime,
    getWebPlan,
    createWebSession,
    resolveInitialNavigation,
    leaf,
    stack,
    serializeNavigation,
    resolveConfiguredMessages,
    type WebAppDefinition,
    type WebAppView,
    type WebConfiguration,
} from "@finesoft/web";
import { materializeServerData } from "./server-data";
import type { SSRAppResult, SSRContext, SSRRenderResult } from "./render";
import { ownRender } from "./render-owner";
import { parseCookieString } from "@finesoft/web";

export interface SSRRenderConfig {
    readonly definition: WebAppDefinition;
    readonly configuration?: WebConfiguration;
    readonly render: (app: WebAppView) => string | SSRAppResult | Promise<string | SSRAppResult>;
    readonly resolveLocale?: (
        url: string,
        request?: Request,
    ) => { lang: string; dir: string } | undefined;
}
/** One request scope and one native root serve ordinary and composed navigation. */
export function createSSRRender(config: SSRRenderConfig) {
    const owner = createWebRuntime({
        ...config.configuration,
        definition: config.definition,
        storageScope: "execution",
    });
    const render = async (url: string, context: SSRContext = {}): Promise<SSRRenderResult> => {
        const configuration = { ...config.definition.configuration, ...config.configuration };
        const resolvedLocale = config.resolveLocale?.(url, context.request);
        const locale = resolvedLocale?.lang ?? configuration.locale;
        const fetch = context.fetch ?? configuration.fetch ?? globalThis.fetch?.bind(globalThis);
        const messages = await resolveConfiguredMessages({
            locale,
            loadMessages: config.definition.loadMessages,
            context: locale
                ? { runtime: "server", url, request: context.request, fetch }
                : undefined,
        });
        const web = createWebRuntime({
            ...configuration,
            definition: config.definition,
            runtime: owner.runtime,
            storageScope: "execution",
            locale,
            messages,
            fetch,
            safeFetch: { ...context.safeFetch, ...configuration.safeFetch },
            invocation: {
                signal: context.request?.signal,
                identity: context.identity,
                traceId: context.traceId,
                fetch,
                bindings: { ...context.bindings, request: context.request },
            },
        });
        let controller: ReturnType<typeof createWebSession> | undefined;
        const execution = web.createExecution();
        let failed = false;
        try {
            const resolved = await resolveInitialNavigation(web, url);
            const initial = resolved?.tree ?? stack(leaf("@finesoft/not-found", {}, { url }));
            const base = {
                head: "",
                css: "",
                html: "",
                serverData: { pages: [] },
                locale: resolvedLocale ?? web.getLocale(),
            } satisfies SSRRenderResult;
            if (resolved?.renderMode === "csr") return { ...base, renderMode: "csr" };
            let redirect: { url: string; status: number } | undefined;
            const cookies = parseCookieString(context.request?.headers.get("cookie") ?? "");
            controller = createWebSession({
                navigate: async () => {
                    throw Error("SSR views cannot initiate navigation");
                },
                web,
                execution,
                initial,
                isServer: true,
                onRedirect: (value) => {
                    redirect ??= value;
                },
                createContext: ({ intent, params, url: matchedUrl }) => ({
                    container: execution.context.container,
                    navigation: {
                        url: matchedUrl ?? url,
                        path: new URL(matchedUrl ?? url, "http://localhost").pathname,
                        intent: { id: intent, params },
                        params,
                        container: execution.context.container,
                        isServer: true,
                        getCookie: (name) => cookies.get(name),
                        getHeader: (name) => context.request?.headers.get(name) ?? undefined,
                    },
                }),
            });
            const candidate = await controller.start();
            if (redirect || candidate.redirect)
                return { ...base, redirect: redirect ?? candidate.redirect };
            const snapshot = candidate;
            const status = snapshot.destinations.at(-1)?.status;
            // Materialize while execution resources are alive. Serialization reuses this projection.
            execution.context.signal.throwIfAborted();
            const serverData = materializeServerData(
                status
                    ? { pages: [] }
                    : {
                          tree: serializeNavigation(snapshot.tree),
                          pages: snapshot.destinations.map((entry) => ({
                              entryId: entry.entryId,
                              intent: { id: entry.intent, params: entry.params },
                              data: entry.page,
                          })),
                      },
            );
            const native = await config.render(controller);
            execution.context.signal.throwIfAborted();
            const output = typeof native === "string" ? { html: native } : native;
            return {
                ...base,
                ...output,
                head: output.head ?? "",
                css: output.css ?? "",
                serverData,
                renderMode: snapshot.destinations.at(-1)?.renderMode ?? resolved?.renderMode,
                locale: resolvedLocale ?? web.getLocale(),
                status,
                rewriteUrl: snapshot.destinations.at(-1)?.rewriteUrl,
                ...(!status &&
                snapshot.destinations.length &&
                snapshot.destinations.every((d) => d.cache === "public")
                    ? { cache: "public" as const }
                    : {}),
            };
        } catch (error) {
            failed = true;
            throw error;
        } finally {
            const cleaned = await Promise.allSettled([
                controller?.dispose(),
                execution.dispose(),
                web.dispose(),
            ]);
            const errors = cleaned
                .filter((result) => result.status === "rejected")
                .map((result) => result.reason);
            // Successful rendering must still report cleanup failure; preserve any primary error.
            // eslint-disable-next-line no-unsafe-finally
            if (!failed && errors.length) throw new AggregateError(errors, "SSR cleanup failed");
        }
    };
    return Object.assign(
        ownRender(render, () => owner.dispose()),
        { routes: getWebPlan(config.definition).routes },
    );
}
