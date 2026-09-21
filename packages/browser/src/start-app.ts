import { detectPlatform, ExecutionError } from "@finesoft/core";
import {
    ACTION_KINDS,
    collectVisibleDestinations,
    createWebRuntime,
    createWebSession,
    createActiveLeafCodec,
    resolveInitialNavigation,
    createSessionStore,
    leaf,
    mapNavigationLeaves,
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
    type WebSession,
    type NavigationSnapshot,
    type NavigationContextInput,
    type FlowAction,
    type ExternalUrlAction,
    type ActionInvocation,
    type TreeAction,
    type BasePage,
} from "@finesoft/web";
import { createNavigationBridge, type NavigationBridge } from "./navigation-bridge";
import { deserializeServerData } from "./server-data";
import { createSessionBridge, type BrowserSession } from "./session-bridge";
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
export interface BrowserAppConfig<Definition extends WebAppDefinition = WebAppDefinition> {
    readonly definition: Definition;
    readonly target: HTMLElement;
    readonly history?: "browser" | "memory";
    readonly url?: string;
    readonly persistenceKey?: string;
    readonly session?: BrowserSessionConfig;
    readonly domRestore?: boolean;
    readonly buildId?: string;
    readonly serverDataSource?: HTMLScriptElement | null;
    readonly onModal?: (
        page: BasePage,
        context: { readonly app: WebAppView<Definition>; readonly snapshot: NavigationSnapshot },
    ) => void | Promise<void>;
}
export interface BrowserAppHandle<
    Definition extends WebAppDefinition = WebAppDefinition,
> extends WebAppView<Definition> {
    readonly shouldHydrate: boolean;
    /** Resolves after the first native commit and optional session restore. Mount before awaiting. */
    readonly ready: Promise<void>;
    dispose(): Promise<void>;
}
const targets = new WeakSet<HTMLElement>();
const windows = new WeakSet<Window>();
export function createBrowserApp<Definition extends WebAppDefinition>(
    config: BrowserAppConfig<Definition>,
): Promise<BrowserAppHandle<Definition>>;
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
    let web: WebRuntime | undefined, controller: WebSession | undefined;
    let disposeSession: WebSession["dispose"] | undefined;
    let bridge: NavigationBridge | undefined,
        session: BrowserSession | undefined,
        dom: DomRestore | undefined;
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
    const domResets = new Set<string>();
    const modalControllers = new Set<WebSession>();
    const modalWork = new Set<Promise<void>>();
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
            for (const modal of modalControllers) modal.cancel();
            for (const waiter of pending.values()) waiter.reject(new ExecutionError("cancelled"));
            pending.clear();
            failReady(new ExecutionError("cancelled"));
            for (const cleanup of cleanups) cleanup();
            bridge?.dispose();
            const errors: unknown[] = [];
            for (const cleanup of [
                () => disposeSession?.(),
                () => Promise.allSettled(modalWork),
                () => session?.dispose(),
                () => dom?.dispose(),
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
        const [log, attributes] = await Promise.all([web.getLogger(), web.getLocale()]);
        if (attributes) {
            target.setAttribute("lang", attributes.lang);
            target.setAttribute("dir", attributes.dir);
        }
        const codec = definition.navigationCodec ?? createActiveLeafCodec();
        const resolveUrl = async (url: string) =>
            (await resolveInitialNavigation(activeWeb, url, { codec }))?.tree;
        function browserUrl(value: string, external = false): URL {
            let url: URL;
            try {
                url = new URL(value, win.location.href);
            } catch {
                throw new ExecutionError("validation", "Invalid browser destination");
            }
            if (
                url.protocol !== "http:" &&
                url.protocol !== "https:" &&
                !(external && (url.protocol === "mailto:" || url.protocol === "tel:"))
            )
                throw new ExecutionError("validation", "Unsupported browser destination protocol");
            return url;
        }
        const initial =
            wire.status === "ready" && wire.data.tree
                ? deserializeNavigation(wire.data.tree)
                : ((await resolveUrl(initialUrl)) ??
                  stack(leaf("@finesoft/not-found", {}, { url: initialUrl })));
        async function navigate(url: string, invocation?: ActionInvocation) {
            if (closed) throw new ExecutionError("configuration", "Browser application is closed");
            const parsed = browserUrl(url);
            if (parsed.origin !== win.location.origin) {
                win.location.assign(parsed.href);
                return;
            }
            const sequence = ++navigationSequence;
            controller!.cancel(invocation);
            const path = parsed.pathname + parsed.search + parsed.hash;
            const tree = controller!.getTree();
            const recovering =
                tree.kind === "stack" &&
                tree.entries.length === 1 &&
                tree.entries[0]?.kind === "leaf" &&
                ["@finesoft/not-found", "@finesoft/error"].includes(tree.entries[0].intent);
            // The fallback root has no application structure to retain yet.
            const overlay =
                (recovering ? await resolveUrl(path) : undefined) ??
                codec.decode(path, activeWeb.router);
            const match = overlay ? undefined : await activeWeb.router.resolve(path);
            if (closed || sequence !== navigationSequence || invocation?.signal?.aborted)
                throw new ExecutionError("cancelled");
            const sameUrl =
                !recovering &&
                parsed.href ===
                    new URL(codec.encode(tree, activeWeb.router), win.location.href).href;
            const action: TreeAction = sameUrl
                ? { kind: "refresh" }
                : overlay
                  ? { kind: "hydrate", tree: overlay }
                  : definition.navigation || definition.navigationCodec
                    ? {
                          kind: "push",
                          intent: match?.intent.id ?? "@finesoft/not-found",
                          params: match?.intent.params,
                          query: match?.intent.query,
                          url: path,
                      }
                    : {
                          kind: "hydrate",
                          tree: stack(
                              leaf(
                                  match?.intent.id ?? "@finesoft/not-found",
                                  match?.intent.params,
                                  { url: path, query: match?.intent.query },
                              ),
                          ),
                      };
            const result = await controller!.perform(action, invocation);
            if (result !== controller!.getSnapshot())
                throw new ExecutionError("denied", "Navigation was not committed");
        }
        const createContext = ({ intent, params, query, url, execution }: NavigationContextInput) =>
            createBrowserContext({
                url: url ?? initialUrl,
                intent: { id: intent, params, query },
                container: execution.container,
            });
        const followRedirect = async (value: { url: string }, candidate: NavigationSnapshot) => {
            const url = browserUrl(value.url);
            if (url.origin !== win.location.origin) {
                win.location.assign(url.href);
                return;
            }
            const path = url.pathname + url.search + url.hash;
            const overlay = codec.decode(path, activeWeb.router);
            if (overlay) return overlay;
            const match = await activeWeb.router.resolve(path);
            const target = leaf(match?.intent.id ?? "@finesoft/not-found", match?.intent.params, {
                url: path,
                query: match?.intent.query,
            });
            const redirected =
                candidate.destinations.find(
                    (entry) => entry.status && entry.status >= 300 && entry.status < 400,
                )?.entryId ?? collectVisibleDestinations(candidate.tree).at(-1)?.entryId;
            return redirected
                ? mapNavigationLeaves(candidate.tree, (entry) =>
                      entry.entryId === redirected ? target : entry,
                  )
                : stack(target);
        };
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
        controller = createWebSession({
            session: () => session,
            commit(revision) {
                if (closed) return;
                acknowledged = revision;
                // Removing a focused native input can emit a final change event.
                // Discard its old DOM state only once the replacement has committed.
                for (const entryId of domResets) {
                    const bag = session?.scope.get(entryId) as Record<string, unknown> | undefined;
                    if (bag) {
                        const { __dom: _oldDom, ...state } = bag;
                        session!.scope.set(entryId, state);
                    }
                }
                domResets.clear();
                pending.get(revision)?.resolve();
                if (mounted) return;
                mounted = true;
                recordPageView(controller!.getSnapshot());
                // Native acknowledgement already happened. Finish this commit's provider registrations.
                queueMicrotask(() => {
                    if (closed) return;
                    void (async () => {
                        await session?.restoreFromUrl(initialUrl);
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
            captureUrl: () =>
                browserHistory
                    ? win.location.pathname + win.location.search
                    : codec.encode(controller!.getTree(), activeWeb.router),
            web,
            initial,
            isServer: false,
            createContext,
            onRedirect: followRedirect,
            viewReady: async (snapshot, signal) => {
                await waitForCommit(controller!.getSnapshot().revision, signal);
                if (!mounted) return;
                if (!restoring) restore();
                recordPageView(snapshot);
            },
        });
        disposeSession = controller.dispose;
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
        controller.onAction<FlowAction>(ACTION_KINDS.FLOW, async (action, invocation) => {
            if (closed) throw new ExecutionError("configuration", "Browser application is closed");
            if (invocation?.signal?.aborted) throw new ExecutionError("cancelled");
            if (action.presentationContext !== "modal") return navigate(action.url, invocation);
            if (!config.onModal)
                throw new ExecutionError("configuration", "Modal actions require onModal");
            const work = (async () => {
                const match = await activeWeb.router.resolve(action.url);
                if (closed || invocation?.signal?.aborted) throw new ExecutionError("cancelled");
                let handedOff = false;
                const modal = createWebSession({
                    web: activeWeb,
                    initial: stack(
                        leaf(match?.intent.id ?? "@finesoft/not-found", match?.intent.params, {
                            url: action.url,
                            query: match?.intent.query,
                        }),
                    ),
                    isServer: false,
                    createContext,
                    onRedirect: async (value, candidate) => {
                        const tree = await followRedirect(value, candidate);
                        handedOff = !tree;
                        return tree;
                    },
                });
                modalControllers.add(modal);
                try {
                    const snapshot = await modal.start(invocation);
                    if (closed || handedOff) return;
                    const page = snapshot.destinations.at(-1)?.page;
                    if (page) await config.onModal!(page, { app: controller!, snapshot });
                } finally {
                    await modal.dispose();
                    modalControllers.delete(modal);
                }
            })();
            modalWork.add(work);
            try {
                await work;
            } finally {
                modalWork.delete(work);
            }
        });
        controller.onAction<ExternalUrlAction>(ACTION_KINDS.EXTERNAL_URL, (action, invocation) => {
            if (closed) throw new ExecutionError("configuration", "Browser application is closed");
            if (invocation?.signal?.aborted) throw new ExecutionError("cancelled");
            win.open(browserUrl(action.url, true).href, "_blank", "noopener,noreferrer");
        });
        cleanups.push(
            controller.onCommit((next, previousSnapshot) => {
                capture();
                for (const destination of next.destinations) {
                    const previous = previousSnapshot.entries.find(
                        (entry) => entry.entryId === destination.entryId,
                    );
                    if (previous && previous.page.pageType !== destination.page.pageType && session)
                        domResets.add(destination.entryId);
                }
            }),
        );
        if (config.session) {
            const store = createSessionStore({
                ...config.session,
                storage: config.session.storage ?? createWebStorage("local"),
                key: `finesoft:${definition.id}:${config.persistenceKey}`,
                navigation: controller,
            });
            for (const provider of config.session.providers ?? []) store.register(provider);
            session = createSessionBridge({
                store,
                navigation: controller,
                subscribeNavigation: controller.subscribe,
                debounceMs: config.session.debounceMs,
                shouldRestore: config.session.shouldRestore,
                deferPersistenceUntilRestore: true,
            });
            if (config.domRestore) {
                dom = createDomRestore({
                    schedule: (callback) => callback(),
                    get scope() {
                        return session!.scope;
                    },
                });
                dom.attach(target);
            }
        }
        await controller.start();
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
            void controller!.perform({ kind: "flow", url: url.href }).catch((error) => {
                if (!(error instanceof ExecutionError && error.code === "cancelled"))
                    log.error("Navigation failed", error);
            });
        };
        target.addEventListener("click", onClick);
        cleanups.push(() => target.removeEventListener("click", onClick));
        return Object.assign(controller, {
            shouldHydrate: wire.status === "ready" && target.hasChildNodes(),
            ready,
            dispose,
        });
    } catch (error) {
        await dispose().catch(() => {});
        throw error;
    }
}
