import { detectPlatform, ExecutionError } from "@finesoft/core";
import {
    createWebRuntime,
    createAppView,
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
    type WebAppDefinition,
    type WebAppView,
    type SessionStateProvider,
    type SessionSnapshot,
    type AsyncStorage,
    type WebRuntime,
    type NavigationController,
    type NavigationSnapshot,
} from "@finesoft/web";
import { createNavigationBridge, type NavigationHandle } from "./navigation-bridge";
import { deserializeServerData } from "./server-data";
import { createSessionBridge, type SessionHandle } from "./session-bridge";
import { createWebStorage } from "./web-storage";
import { createDomRestore, type DomRestore } from "./dom-restore";
import { createBrowserContext } from "./middleware/context";

export interface BrowserSessionConfig {
    readonly providers?: readonly SessionStateProvider[];
    readonly storage?: AsyncStorage;
    readonly version?: number;
    readonly maxAgeMs?: number;
    readonly debounceMs?: number;
    readonly shouldRestore?: (snapshot: SessionSnapshot, currentUrl: string) => boolean;
}
export interface BrowserAppConfig {
    readonly definition: WebAppDefinition;
    readonly target: HTMLElement;
    readonly history?: "browser" | "memory";
    readonly url?: string;
    readonly persistenceKey?: string;
    readonly session?: BrowserSessionConfig;
    readonly domRestore?: boolean;
    readonly buildId?: string;
    readonly serverDataSource?: HTMLScriptElement | null;
}
export interface BrowserAppHandle extends WebAppView {
    readonly hydrate: boolean;
    /** Resolves after the first native commit and optional session restore. Mount before awaiting. */
    readonly ready: Promise<void>;
    dispose(): Promise<void>;
}
const targets = new WeakSet<HTMLElement>();
const windows = new WeakSet<Window>();
export async function createBrowserApp(config: BrowserAppConfig): Promise<BrowserAppHandle> {
    const { target, definition } = config;
    if (!target) throw Error("A browser target is required");
    const ownerWindow = target.ownerDocument.defaultView;
    if (!ownerWindow) throw Error("A browser window is required");
    const win = ownerWindow;
    const browserHistory = (config.history ?? "browser") === "browser";
    if (targets.has(target)) throw Error("Browser target already owned");
    if (browserHistory && windows.has(win))
        throw Error("Browser history already owned; use memory history for embedded apps");
    if (config.session && !config.persistenceKey)
        throw Error("Session requires a stable persistenceKey");
    if (config.domRestore && !config.session) throw Error("DOM restore requires session storage");
    targets.add(target);
    if (browserHistory) windows.add(win);
    let web: WebRuntime | undefined, controller: NavigationController | undefined;
    let bridge: NavigationHandle | undefined,
        session: SessionHandle | undefined,
        dom: DomRestore | undefined;
    let presentation: ReturnType<typeof createAppView> | undefined;
    let closed = false,
        mounted = false,
        restoring = !!config.session;
    let acknowledged = 0,
        navigationSequence = 0,
        disposal: Promise<void> | undefined;
    let settleReady!: () => void, failReady!: (error: unknown) => void;
    const ready = new Promise<void>((resolve, reject) => {
        settleReady = resolve;
        failReady = reject;
    });
    void ready.catch(() => {});
    const pending = new Map<number, { resolve: () => void; reject: (error: unknown) => void }>();
    const cleanups: (() => void)[] = [];
    const originalLocale = {
        lang: target.getAttribute("lang"),
        dir: target.getAttribute("dir"),
        "data-fs-app": target.getAttribute("data-fs-app"),
    };
    target.setAttribute("data-fs-app", definition.id);
    const containers = () =>
        [...target.querySelectorAll<HTMLElement>("[data-fs-entry]")].filter(
            (element) => element.closest("[data-fs-app]") === target,
        );
    const capture = () => {
        if (!restoring) for (const element of containers()) dom?.captureEntry(element);
    };
    const restore = () => {
        for (const element of containers()) if (!element.hidden) dom?.restoreEntry(element);
    };
    const dispose = (): Promise<void> =>
        (disposal ??= (async () => {
            capture();
            closed = true;
            controller?.cancel();
            for (const waiter of pending.values()) waiter.reject(new ExecutionError("cancelled"));
            pending.clear();
            failReady(new ExecutionError("cancelled"));
            for (const cleanup of cleanups) cleanup();
            bridge?.dispose();
            const errors: unknown[] = [];
            for (const cleanup of [
                () => controller?.dispose(),
                () => session?.dispose(),
                () => dom?.dispose(),
                () => presentation?.dispose(),
                () => web?.dispose(),
            ]) {
                try {
                    await cleanup();
                } catch (error) {
                    errors.push(error);
                }
            }
            for (const [key, value] of Object.entries(originalLocale)) {
                if (value === null) target.removeAttribute(key);
                else target.setAttribute(key, value);
            }
            targets.delete(target);
            if (browserHistory) windows.delete(win);
            if (errors.length) throw new AggregateError(errors, "Browser cleanup failed");
        })());
    try {
        const initialUrl =
            config.url ?? (browserHistory ? win.location.pathname + win.location.search : "/");
        const wire = deserializeServerData({
            script:
                config.serverDataSource === undefined
                    ? target.querySelector<HTMLScriptElement>("script[data-fs-server-data]")
                    : config.serverDataSource,
            buildId: config.buildId,
        });
        const configuration = definition.configuration ?? {};
        const locale =
            configuration.locale ??
            target.getAttribute("lang") ??
            target.ownerDocument.documentElement.lang ??
            undefined;
        const fetch = configuration.fetch ?? globalThis.fetch?.bind(globalThis);
        const messages = await resolveConfiguredMessages({
            locale,
            loadMessages: definition.loadMessages,
            context: locale ? { runtime: "browser", url: initialUrl, fetch } : undefined,
        });
        web = createWebRuntime({
            ...configuration,
            definition,
            locale,
            fetch,
            messages,
            safeFetch: { validateDns: false, ...configuration.safeFetch },
            platform:
                configuration.platform ??
                detectPlatform(win.navigator.userAgent, win.navigator.maxTouchPoints),
            prefetchedIntents:
                wire.status === "ready"
                    ? PrefetchedIntents.fromArray(wire.data.pages)
                    : PrefetchedIntents.empty(),
        });
        const activeWeb = web;
        const log = web.getLogger();
        const attributes = web.getLocale();
        if (attributes) {
            target.setAttribute("lang", attributes.lang);
            target.setAttribute("dir", attributes.dir);
        }
        const codec = definition.navigationCodec ?? createActiveLeafCodec();
        const resolveUrl = async (url: string) =>
            (await resolveInitialNavigation(activeWeb, url, { codec }))?.tree;
        const initial =
            wire.status === "ready" && wire.data.tree
                ? deserializeNavigation(wire.data.tree)
                : ((await resolveUrl(initialUrl)) ??
                  stack(leaf("@finesoft/not-found", {}, { url: initialUrl })));
        async function navigate(url: string) {
            if (closed) throw new ExecutionError("configuration", "Browser application is closed");
            const parsed = new URL(url, win.location.href);
            if (parsed.origin !== win.location.origin) {
                win.location.assign(parsed.href);
                return;
            }
            const sequence = ++navigationSequence;
            controller!.cancel();
            const tree = await resolveUrl(parsed.pathname + parsed.search + parsed.hash);
            if (closed || sequence !== navigationSequence) throw new ExecutionError("cancelled");
            const result = await controller!.hydrate(
                tree ?? stack(leaf("@finesoft/not-found", {}, { url })),
            );
            if (result !== controller!.getSnapshot())
                throw new ExecutionError("denied", "Navigation was not committed");
        }
        const waitForCommit = (revision: number, signal?: AbortSignal): Promise<void> => {
            if (!mounted || revision === acknowledged) return Promise.resolve();
            if (signal?.aborted || closed) return Promise.reject(new ExecutionError("cancelled"));
            return new Promise<void>((resolve, reject) => {
                const finish = (error?: unknown) => {
                    pending.delete(revision);
                    signal?.removeEventListener("abort", abort);
                    if (error) reject(error);
                    else resolve();
                };
                const abort = () => finish(new ExecutionError("cancelled"));
                pending.set(revision, { resolve: () => finish(), reject: finish });
                signal?.addEventListener("abort", abort, { once: true });
            });
        };
        const recordPageView = (snapshot: NavigationSnapshot) => {
            const page = snapshot.destinations.at(-1)?.page;
            if (page)
                activeWeb.runtime.record("PageView", {
                    page: page.pageType,
                    pageId: page.id,
                    title: page.title,
                    transitionId: snapshot.transitionId,
                });
        };
        controller = createNavigationController({
            web,
            initial,
            isServer: false,
            createContext: ({ intent, params, url, execution }) => ({
                container: execution.container,
                navigation: createBrowserContext({
                    url: url ?? initialUrl,
                    intent: { id: intent, params },
                    container: execution.container,
                }),
            }),
            onRedirect: async (value) => {
                const url = new URL(value.url, win.location.href);
                if (url.origin !== win.location.origin) {
                    win.location.assign(url.href);
                    return;
                }
                return resolveUrl(url.pathname + url.search);
            },
            viewReady: async (snapshot, signal) => {
                await waitForCommit(presentation!.view.getSnapshot().revision, signal);
                if (!mounted) return;
                if (!restoring) restore();
                recordPageView(snapshot);
            },
        });
        if (browserHistory)
            bridge = createNavigationBridge({
                controller,
                codec,
                router: web.router,
                log,
                onPopStart: () => {
                    navigationSequence++;
                },
                resolveUrl,
                getScrollablePageElement: () =>
                    target.querySelector<HTMLElement>("[data-fs-scroll]") ?? target,
            });
        presentation = createAppView({
            web,
            controller,
            navigate,
            session: () => session,
            commit(revision) {
                if (closed) return;
                acknowledged = revision;
                pending.get(revision)?.resolve();
                if (mounted) return;
                mounted = true;
                recordPageView(controller!.getSnapshot());
                // Native acknowledgement already happened. Finish this commit's provider registrations.
                queueMicrotask(() => {
                    if (closed) return;
                    void (async () => {
                        await session?.restore(initialUrl);
                        if (closed) return;
                        restoring = false;
                        restore();
                        settleReady();
                    })().catch((error) => {
                        restoring = false;
                        failReady(error);
                        log.error("Session restore failed", error);
                    });
                });
            },
        });
        cleanups.push(
            controller.onCommit((next) => {
                capture();
                for (const destination of next.destinations) {
                    const previous = presentation!.view
                        .getSnapshot()
                        .entries.find((entry) => entry.entryId === destination.entryId);
                    if (
                        previous &&
                        previous.page.pageType !== destination.page.pageType &&
                        session
                    ) {
                        const bag = session.scope.get(destination.entryId) as
                            | Record<string, unknown>
                            | undefined;
                        if (bag) {
                            const { __dom: _oldDom, ...state } = bag;
                            session.scope.set(destination.entryId, state);
                        }
                    }
                }
            }),
        );
        if (config.session) {
            const adapter = createNavigationSessionAdapter(controller, () =>
                browserHistory
                    ? win.location.pathname + win.location.search
                    : codec.encode(controller!.getTree(), activeWeb.router),
            );
            const store = createSessionStore({
                ...config.session,
                storage: config.session.storage ?? createWebStorage("local"),
                key: `finesoft:${definition.id}:${config.persistenceKey}`,
                navigation: adapter,
            });
            for (const provider of config.session.providers ?? []) store.register(provider);
            session = createSessionBridge({
                store,
                adapter,
                subscribeNavigation: (listener) => controller!.subscribe(listener),
                debounceMs: config.session.debounceMs,
                shouldRestore: config.session.shouldRestore,
                deferPersistenceUntilRestore: true,
            });
            if (config.domRestore) {
                dom = createDomRestore({
                    schedule: (callback) => callback(),
                    scope: {
                        get: (key) => session!.scope.get(key),
                        set: (key, value) => session!.scope.set(key, value),
                        delete: (key) => session!.scope.delete(key),
                        keys: () => session!.scope.keys(),
                        prune: (ids) => session!.scope.prune(ids),
                    },
                });
                dom.attach(target);
            }
        }
        const first = await controller.resolve();
        if (first !== controller.getSnapshot()) presentation.present(first);
        const onClick = (event: MouseEvent) => {
            if (
                event.defaultPrevented ||
                event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.altKey ||
                event.shiftKey
            )
                return;
            const anchor = (event.target as Element | null)?.closest?.(
                "a[href]",
            ) as HTMLAnchorElement | null;
            if (
                !anchor ||
                !target.contains(anchor) ||
                anchor.closest("[data-fs-app]") !== target ||
                anchor.hasAttribute("download") ||
                (anchor.target && anchor.target !== "_self") ||
                anchor.rel.split(/\s+/).includes("external")
            )
                return;
            const url = new URL(anchor.href, win.location.href);
            if (url.origin !== win.location.origin || !["http:", "https:"].includes(url.protocol))
                return;
            if (
                url.pathname === win.location.pathname &&
                url.search === win.location.search &&
                url.hash
            )
                return;
            event.preventDefault();
            void navigate(url.href).catch((error) => {
                if (!(error instanceof ExecutionError && error.code === "cancelled"))
                    log.error("Navigation failed", error);
            });
        };
        target.addEventListener("click", onClick);
        cleanups.push(() => target.removeEventListener("click", onClick));
        return Object.assign(presentation.view, {
            hydrate: wire.status === "ready" && target.hasChildNodes(),
            ready,
            dispose,
        });
    } catch (error) {
        await dispose().catch(() => {});
        throw error;
    }
}
