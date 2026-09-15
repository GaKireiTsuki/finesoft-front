import { DEP_KEYS, detectPlatform, type LoggerFactory } from "@finesoft/core";
import {
    Framework,
    type BasePage,
    ACTION_KINDS,
    createNavigationController,
    createActiveLeafCodec,
    resolveInitialNavigation,
    createNavigationSessionAdapter,
    createSessionStore,
    leaf,
    stack,
    mapNavigationLeaves,
    collectVisibleDestinations,
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
    let lastPageType: string | undefined;
    let navigationSequence = 0;
    const modalWork = new Set<Promise<void>>();
    const modalControllers = new Set<NavigationController>();
    const localeBefore = {
        lang: target.getAttribute("lang"),
        dir: target.getAttribute("dir"),
        "data-fs-entry": target.getAttribute("data-fs-entry"),
        "data-fs-key": target.getAttribute("data-fs-key"),
    };
    const dispose = (): Promise<void> =>
        (disposing ??= (async () => {
            closed = true;
            for (const modal of modalControllers) modal.cancel();
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
        let renderSnapshot: NavigationSnapshot;
        const context: RenderContext = {
            framework: fw,
            get app() {
                return handle;
            },
            get snapshot() {
                return renderSnapshot;
            },
        };
        async function render(snapshot: NavigationSnapshot) {
            if (closed) return;
            renderSnapshot = snapshot;
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
                const resetType = lastEntry === entry && lastPageType !== page.pageType;
                if (root && (lastEntry !== entry || resetType)) {
                    await root.dispose();
                    root = undefined;
                    target.replaceChildren();
                    // Unmounting a focused native input can emit a final change event.
                    // Discard its captured draft only after the previous view is gone.
                    if (resetType) target.dispatchEvent(new Event("fs:reset", { bubbles: true }));
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
                lastPageType = page.pageType;
            }
            fw.currentEntry = collectVisibleDestinations(snapshot.tree).at(-1);
            try {
                fw.didEnterPage(page);
            } catch (error) {
                log.error("didEnterPage error:", error);
            }
        }
        const createContext = ({
            intent,
            params,
            url,
        }: {
            intent: string;
            params: Record<string, unknown>;
            url?: string;
        }) => ({
            container: fw.container,
            navigation: createBrowserContext({
                url: url ?? codec.encode(leaf(intent, params), fw.router),
                intent: { id: intent, params },
                container: fw.container,
            }),
            url,
        });
        const redirect = async ({ url }: { url: string }, candidate: NavigationSnapshot) => {
            const destination = new URL(url, window.location.origin);
            if (destination.origin !== window.location.origin) {
                window.location.assign(destination.href);
                return;
            }
            const path = destination.pathname + destination.search + destination.hash;
            const match = await fw.router.resolve(path);
            const redirectedEntry = candidate.destinations.find(
                (item) => item.status && item.status >= 300 && item.status < 400,
            )?.entryId;
            return mapNavigationLeaves(candidate.tree, (item) =>
                item.entryId === redirectedEntry
                    ? leaf(match?.intent.id ?? "@finesoft/not-found", match?.intent.params, {
                          url: path,
                      })
                    : item,
            );
        };
        controller = createNavigationController({
            framework: fw,
            isServer: false,
            initial,
            getErrorPage: definition.getErrorPage,
            viewReady: render,
            createContext,
            onRedirect: redirect,
        });
        const nav = controller;
        function admitNavigation() {
            if (closed) throw Error("Browser application disposed");
            const sequence = ++navigationSequence;
            nav.cancel();
            return sequence;
        }
        if (browserHistory)
            bridge = createNavigationBridge({
                controller: nav,
                codec,
                router: fw.router,
                log,
                onPopStart: admitNavigation,
                resolveUrl: async (url) => {
                    const sequence = navigationSequence;
                    const resolved = await resolveInitialNavigation(fw, url, {
                        codec,
                        initial: definition.navigation,
                    });
                    return !closed && sequence === navigationSequence ? resolved?.tree : undefined;
                },
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
                const sequence = admitNavigation();
                const match = await fw.router.resolve(url);
                if (closed || sequence !== navigationSequence) return;
                await nav.push(match?.intent.id ?? "@finesoft/not-found", match?.intent.params, {
                    url,
                });
            },
            dispose,
        };
        fw.onAction(ACTION_KINDS.FLOW, async (action: FlowAction) => {
            if (action.presentationContext !== "modal") {
                if (action.entryId) {
                    admitNavigation();
                    await nav.reuseEntry(action.entryId);
                } else await handle.navigate(action.url);
                return;
            }
            const work = (async () => {
                const match = await fw.router.resolve(action.url);
                if (closed) return;
                let delivered = false,
                    handedOff = false;
                const deliver = async (snapshot: NavigationSnapshot) => {
                    const destination = snapshot.destinations.at(-1);
                    if (closed || delivered || handedOff || !destination) return;
                    delivered = true;
                    await config.onModal?.(destination.page, {
                        framework: fw,
                        app: handle,
                        snapshot,
                    });
                };
                const modal = createNavigationController({
                    framework: fw,
                    isServer: false,
                    initial: stack(
                        leaf(match?.intent.id ?? "@finesoft/not-found", match?.intent.params, {
                            url: action.url,
                        }),
                    ),
                    getErrorPage: definition.getErrorPage,
                    createContext,
                    onRedirect: async (destination, candidate) => {
                        const tree = await redirect(destination, candidate);
                        handedOff = tree === undefined;
                        return tree;
                    },
                    viewReady: deliver,
                });
                modalControllers.add(modal);
                try {
                    await deliver(await modal.resolve());
                } finally {
                    await modal.dispose();
                    modalControllers.delete(modal);
                }
            })();
            modalWork.add(work);
            void work.finally(() => modalWork.delete(work)).catch(() => {});
            return work;
        });
        registerExternalUrlHandler({ framework: fw, log });
        const firstSnapshot = await nav.resolve();
        if (
            !root &&
            !entries &&
            !firstSnapshot.destinations.some(
                (item) => item.status && item.status >= 300 && item.status < 400,
            )
        )
            await render(firstSnapshot);
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
