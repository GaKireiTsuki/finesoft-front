import { DEP_KEYS, detectPlatform, type LoggerFactory } from "@finesoft/core";
import {
    Framework,
    loadPage,
    type BasePage,
    ACTION_KINDS,
    createNavigationController,
    createActiveLeafCodec,
    resolveInitialNavigation,
    createNavigationSessionAdapter,
    createSessionStore,
    leaf,
    stack,
    deserializeNavigation,
    PrefetchedIntents,
    resolveConfiguredMessages,
    type FlowAction,
    type WebAppDefinition,
    type NavigationController,
    type NavigationSnapshot,
    type SessionStateProvider,
    type SessionSnapshot,
    type AsyncStorage,
} from "@finesoft/web";
import { createNavigationBridge, type NavigationHandle } from "./navigation-bridge";
import { deserializeServerData } from "./server-data";
import { createSessionBridge, type SessionHandle } from "./session-bridge";
import { createWebStorage } from "./web-storage";
import { createDomRestore, type DomRestore } from "./dom-restore";
import { createBrowserContext } from "./middleware/context";
import { resolveIslandsShell } from "./islands-shell";
import { registerExternalUrlHandler } from "./action-handlers/external-url-action";
import type { BrowserRenderer, RenderContext, ViewHandle } from "./renderer";
import { createEntryRenderer } from "./navigation-islands";

export interface BrowserSessionConfig {
    readonly providers?: readonly SessionStateProvider[];
    readonly storage?: AsyncStorage;
    readonly version?: number;
    readonly maxAgeMs?: number;
    readonly debounceMs?: number;
    readonly shouldRestore?: (snapshot: SessionSnapshot, currentUrl: string) => boolean;
}
export interface BrowserAppConfig {
    readonly app: WebAppDefinition;
    readonly renderer: BrowserRenderer;
    readonly target: HTMLElement;
    readonly history?: "browser" | "memory";
    readonly url?: string;
    readonly persistenceKey?: string;
    readonly session?: BrowserSessionConfig;
    readonly domRestore?: boolean;
    readonly buildId?: string;
    readonly serverDataSource?: HTMLScriptElement | null;
    readonly onModal?: (page: BasePage, context: RenderContext) => void | Promise<void>;
}
export interface BrowserAppHandle {
    readonly framework: Framework;
    readonly runtime: Framework["runtime"];
    readonly navigation?: NavigationHandle;
    readonly session?: SessionHandle;
    navigate(url: string): Promise<void>;
    refresh(): Promise<NavigationSnapshot>;
    getSnapshot(): NavigationSnapshot;
    subscribe(listener: (snapshot: NavigationSnapshot) => void): () => void;
    dispose(): Promise<void>;
}
const targets = new WeakSet<HTMLElement>();
const windows = new WeakSet<Window>();
export async function startBrowserApp(config: BrowserAppConfig): Promise<BrowserAppHandle> {
    const { target, app: definition, renderer } = config;
    if (!target) throw Error("A browser target is required");
    if (targets.has(target)) throw Error("Browser target already owned");
    const browserHistory = (config.history ?? "browser") === "browser";
    if (browserHistory && windows.has(window))
        throw Error("Browser history already owned; use memory history for embedded apps");
    if (config.session && !config.persistenceKey)
        throw Error("Session requires a stable persistenceKey");
    targets.add(target);
    if (browserHistory) windows.add(window);
    let framework: Framework | undefined,
        controller: NavigationController | undefined,
        bridge: NavigationHandle | undefined,
        session: SessionHandle | undefined,
        dom: DomRestore | undefined;
    let root: ViewHandle | undefined,
        entries: ReturnType<typeof createEntryRenderer> | undefined,
        closed = false,
        disposing: Promise<void> | undefined;
    let lastEntry: string | undefined;
    let navigationSequence = 0;
    const cancellation = new AbortController();
    const modalWork = new Set<Promise<void>>();
    const localeBefore = {
        lang: target.getAttribute("lang"),
        dir: target.getAttribute("dir"),
        "data-fs-entry": target.getAttribute("data-fs-entry"),
        "data-fs-key": target.getAttribute("data-fs-key"),
    };
    const dispose = (): Promise<void> =>
        (disposing ??= (async () => {
            closed = true;
            cancellation.abort();
            controller?.cancel();
            bridge?.dispose();
            const errors: unknown[] = [];
            const clean = async (fn: () => unknown) => {
                try {
                    await fn();
                } catch (error) {
                    errors.push(error);
                }
            };
            await clean(() => controller?.dispose());
            await Promise.allSettled(modalWork);
            await clean(() => session?.dispose());
            await clean(() => dom?.dispose());
            await clean(() => entries?.dispose());
            await clean(() => root?.dispose());
            await clean(() => framework?.dispose());
            for (const [key, value] of Object.entries(localeBefore)) {
                if (value === null) target.removeAttribute?.(key);
                else target.setAttribute(key, value);
            }
            targets.delete(target);
            if (browserHistory) windows.delete(window);
            if (errors.length)
                throw new AggregateError(errors, "Browser application cleanup failed");
        })());
    try {
        const initialUrl =
            config.url ??
            (browserHistory ? window.location.pathname + window.location.search : "/");
        const wire = deserializeServerData({
            script:
                config.serverDataSource === undefined
                    ? target.querySelector<HTMLScriptElement>("script[data-fs-server-data]")
                    : config.serverDataSource,
            buildId: config.buildId,
        });
        const prefetched =
            wire.status === "ready"
                ? PrefetchedIntents.fromArray(wire.data)
                : PrefetchedIntents.empty();
        const locale =
            definition.frameworkConfig?.locale ??
            target.getAttribute("lang") ??
            target.ownerDocument.documentElement?.lang ??
            undefined;
        const fetchFn = definition.frameworkConfig?.fetch ?? globalThis.fetch?.bind(globalThis);
        if (locale && definition.loadMessages && typeof fetchFn !== "function")
            throw Error("Browser messages loader requires fetch capability");
        const messages = await resolveConfiguredMessages({
            locale,
            loadMessages: definition.loadMessages,
            context: locale ? { runtime: "browser", url: initialUrl, fetch: fetchFn } : undefined,
        });
        const frameworkOptions = {
            ...definition.frameworkConfig,
            definition,
            prefetchedIntents: prefetched,
            locale,
            fetch: fetchFn,
            safeFetch: {
                validateDns: false,
                ...definition.frameworkConfig?.safeFetch,
            },
            platform:
                definition.frameworkConfig?.platform ??
                detectPlatform(
                    globalThis.navigator?.userAgent ?? "",
                    globalThis.navigator?.maxTouchPoints ?? 0,
                ),
            _resolvedMessages: messages,
        };
        framework = Framework.create(frameworkOptions);
        const fw = framework;
        const log = fw.container
            .resolve<LoggerFactory>(DEP_KEYS.LOGGER_FACTORY)
            .loggerFor("browser");
        const resolvedLocale = fw.getLocale();
        if (resolvedLocale) {
            target.setAttribute("lang", resolvedLocale.lang);
            target.setAttribute("dir", resolvedLocale.dir);
        }
        const codec = definition.navigationCodec ?? createActiveLeafCodec();
        const resolved = await resolveInitialNavigation(fw, initialUrl, {
            codec,
            initial: definition.navigation,
        });
        const sentinel =
            wire.status === "ready"
                ? (wire.data.find((item) => item.intent.id === "@finesoft/navigation-tree")
                      ?.data as { tree?: Parameters<typeof deserializeNavigation>[0] } | undefined)
                : undefined;
        const initial = sentinel?.tree
            ? deserializeNavigation(sentinel.tree)
            : (resolved?.tree ?? stack(leaf("@finesoft/not-found")));
        let handle: BrowserAppHandle;
        const context: RenderContext = {
            framework: fw,
            get app() {
                return handle;
            },
            get snapshot() {
                return controller!.getSnapshot();
            },
        };
        async function render(snapshot: NavigationSnapshot) {
            if (closed) return;
            const page =
                snapshot.destinations.at(-1)?.page ??
                definition.getErrorPage(404, "Page not found");
            if (renderer.mode === "entries") {
                if (!entries) {
                    const shell = resolveIslandsShell(target);
                    if (renderer.mountChrome)
                        root = await renderer.mountChrome({
                            target: shell.chromeRoot,
                            page,
                            context,
                            hydrate: wire.status === "ready" && shell.hydrate,
                        });
                    entries = createEntryRenderer({ outlet: shell.outlet, renderer, context });
                } else await root?.update(page);
                await entries.sync(snapshot);
            } else {
                const entry = snapshot.destinations.at(-1)?.entryId;
                if (root && lastEntry !== entry) {
                    await root.dispose();
                    root = undefined;
                    target.replaceChildren();
                }
                if (root) await root.update(page);
                else
                    root = await renderer.mount({
                        target,
                        page,
                        context,
                        hydrate:
                            wire.status === "ready" &&
                            lastEntry === undefined &&
                            target.hasChildNodes(),
                    });
                if (entry) {
                    target.setAttribute("data-fs-entry", "");
                    target.setAttribute("data-fs-key", entry);
                }
                if (lastEntry !== entry) dom?.restoreEntry(target);
                lastEntry = entry;
            }
        }
        controller = createNavigationController({
            framework: fw,
            isServer: false,
            initial,
            getErrorPage: definition.getErrorPage,
            viewReady: render,
            createContext: ({ intent, params, url }) => ({
                container: fw.container,
                navigation: createBrowserContext({
                    url: url ?? codec.encode(leaf(intent, params), fw.router),
                    intent: { id: intent, params },
                    container: fw.container,
                }),
                url,
            }),
            onRedirect: ({ url }) => {
                void handle.navigate(url);
            },
        });
        const nav = controller;
        if (browserHistory)
            bridge = createNavigationBridge({
                controller: nav,
                codec,
                router: fw.router,
                log,
                getScrollablePageElement: () =>
                    target.querySelector<HTMLElement>("[data-fs-scroll]") ?? target,
            });
        if (config.session) {
            const adapter = createNavigationSessionAdapter(nav, () =>
                codec.encode(nav.getTree(), fw.router),
            );
            const store = createSessionStore({
                storage: config.session.storage ?? createWebStorage("session"),
                navigation: adapter,
                key: config.persistenceKey!,
                version: config.session.version,
                maxAgeMs: config.session.maxAgeMs,
            });
            for (const provider of config.session.providers ?? []) store.register(provider);
            session = createSessionBridge({
                store,
                adapter,
                deferPersistenceUntilRestore: true,
                subscribeNavigation: (fn) => nav.subscribe(fn),
                debounceMs: config.session.debounceMs,
                shouldRestore: config.session.shouldRestore,
            });
        }
        const navigation: NavigationHandle = bridge ?? nav;
        handle = {
            framework: fw,
            runtime: fw.runtime,
            navigation:
                definition.navigation || renderer.mode === "entries" ? navigation : undefined,
            session,
            refresh: () => nav.refresh(),
            getSnapshot: () => nav.getSnapshot(),
            subscribe: (fn) => nav.subscribe(fn),
            async navigate(url) {
                if (closed) throw Error("Browser application disposed");
                const sequence = ++navigationSequence;
                nav.cancel();
                const match = await fw.router.resolve(url);
                if (closed || sequence !== navigationSequence) return;
                await nav.push(match?.intent.id ?? "@finesoft/not-found", match?.intent.params, {
                    url,
                });
            },
            dispose,
        };
        fw.onAction(ACTION_KINDS.FLOW, (action: FlowAction) => {
            if (action.presentationContext !== "modal") return handle.navigate(action.url);
            const work = (async () => {
                const execution = fw.createExecution({ signal: cancellation.signal });
                try {
                    const result = await loadPage({
                        framework: fw,
                        target: action.url,
                        execution,
                        signal: cancellation.signal,
                        createContext: ({ url, intent, execution }) =>
                            createBrowserContext({
                                url,
                                intent,
                                container: execution.context.container,
                            }),
                    });
                    if (closed) return;
                    if (result.kind === "redirect") await handle.navigate(result.url);
                    else
                        await config.onModal?.(
                            result.kind === "page"
                                ? result.page
                                : definition.getErrorPage(result.status, result.message),
                            context,
                        );
                } finally {
                    await execution.dispose();
                }
            })();
            modalWork.add(work);
            void work.finally(() => modalWork.delete(work)).catch(() => {});
            return work;
        });
        registerExternalUrlHandler({ framework: fw, log });
        const firstSnapshot = await nav.resolve();
        if (!root && !entries) await render(firstSnapshot);
        if (session) {
            await session.restore(initialUrl);
            if (config.domRestore) {
                dom = createDomRestore({
                    scope: session.scope,
                    schedule: (callback) => callback(),
                });
                dom.attach(entries?.outlet ?? target);
            }
        }
        return handle;
    } catch (error) {
        await dispose().catch(() => {});
        throw error;
    }
}
