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
    SERVER_REQUEST,
    type ServerRequestState,
    type ServerControllerRequest,
} from "@finesoft/web";
import { materializeServerData } from "./server-data";
import type { SSRAppResult, SSRContext, SSRRenderResult } from "./render";
import { parseCookieString } from "@finesoft/web";
import { ExecutionError, type LocaleAttributes } from "@finesoft/core";

export interface SSRRenderConfig<Definition extends WebAppDefinition = WebAppDefinition> {
    readonly definition: Definition;
    readonly configuration?: WebConfiguration;
    readonly render: (
        app: WebAppView<Definition>,
    ) => string | SSRAppResult | Promise<string | SSRAppResult>;
    readonly resolveLocale?: (url: string, request?: Request) => LocaleAttributes | undefined;
}
/** One request scope and one native root serve ordinary and composed navigation. */
export function createSSRRender<Definition extends WebAppDefinition>(
    config: SSRRenderConfig<Definition>,
) {
    const owner = createWebRuntime({
        ...config.configuration,
        definition: config.definition,
        storageScope: "execution",
    });
    const active = new Set<Promise<SSRRenderResult>>();
    let closing: Promise<void> | undefined;
    const render = async (
        url: string,
        context: SSRContext = {},
        remote?: ServerControllerRequest,
    ): Promise<SSRRenderResult> => {
        const request = context.request ?? new Request(new URL(url || "/", "http://localhost"));
        const requestState: ServerRequestState = context.requestState ?? {
            request,
            responseHeaders: new Headers(),
            remote: !!remote,
            cookies: parseCookieString(request.headers.get("cookie") ?? ""),
        };
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
            localeAttributes: resolvedLocale,
            messages,
            fetch,
            safeFetch: { ...context.safeFetch, ...configuration.safeFetch },
            invocation: {
                signal: context.request?.signal,
                identity: context.identity,
                traceId: context.traceId,
                fetch,
                bindings: {
                    ...context.bindings,
                    request: context.request,
                    [SERVER_REQUEST]: { ...requestState, remote: !!remote },
                },
            },
        });
        let controller: ReturnType<typeof createWebSession<Definition>> | undefined;
        const execution = web.createExecution();
        let failed = false;
        try {
            const resolved = remote ? undefined : await resolveInitialNavigation(web, url);
            const initial = remote
                ? stack(
                      leaf(remote.intent, remote.params, {
                          query: remote.query,
                          ...(remote.url ? { url: remote.url } : {}),
                      }),
                  )
                : (resolved?.tree ?? stack(leaf("@finesoft/not-found", {}, { url })));
            const base = {
                head: "",
                css: "",
                html: "",
                serverData: { pages: [] },
                locale: await web.getLocale(execution),
                headers: requestState.responseHeaders,
            } satisfies SSRRenderResult;
            if (!remote && resolved?.renderMode === "csr") return { ...base, renderMode: "csr" };
            let redirect: { url: string; status: number } | undefined;
            const cookies = requestState.cookies;
            controller = createWebSession({
                web,
                execution,
                initial,
                isServer: true,
                onRedirect: (value) => {
                    redirect ??= value;
                },
                createContext: ({ intent, params, query, url: matchedUrl }) => ({
                    url: matchedUrl ?? url,
                    path: new URL(matchedUrl ?? url, "http://localhost").pathname,
                    intent: { id: intent, params, query },
                    params,
                    query: query ?? {},
                    container: execution.context.container,
                    isServer: true,
                    getCookie: (name) => cookies.get(name),
                    getHeader: (name) => context.request?.headers.get(name) ?? undefined,
                }),
            });
            for (const kind of ["flow", "externalUrl"])
                controller.onAction(kind, () => {
                    throw new ExecutionError(
                        "configuration",
                        "SSR views cannot initiate browser actions",
                    );
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
                              intent: {
                                  id: entry.intent,
                                  params: entry.params,
                                  ...(entry.query ? { query: entry.query } : {}),
                              },
                              data: entry.page,
                          })),
                      },
            );
            const native = remote ? "" : await config.render(controller);
            execution.context.signal.throwIfAborted();
            const output = typeof native === "string" ? { html: native } : native;
            return {
                ...base,
                ...output,
                head: output.head ?? "",
                css: output.css ?? "",
                serverData,
                renderMode: snapshot.destinations.at(-1)?.renderMode ?? resolved?.renderMode,
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
    const run = (url: string, context?: SSRContext, remote?: ServerControllerRequest) => {
        if (closing) return Promise.reject(Error("SSR renderer disposed"));
        const work = render(url, context, remote);
        active.add(work);
        void work.then(
            () => active.delete(work),
            () => active.delete(work),
        );
        return work;
    };
    return Object.assign(run, {
        controller: (input: ServerControllerRequest, context: SSRContext) =>
            run(input.url || "/", context, input),
        routes: getWebPlan(config.definition).routes,
        dispose: () =>
            (closing ??= (async () => {
                while (active.size) await Promise.allSettled(active);
                await owner.dispose();
            })()),
    });
}
