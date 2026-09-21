import {
    createRuntime,
    defineApp,
    provide,
    DEP_KEYS,
    ExecutionError,
    ConsoleLoggerFactory,
    CompositeLoggerFactory,
    ReportingLoggerFactory,
    getLocaleAttributes,
    resolveMessages,
    SimpleTranslator,
    secureFetch,
    detectPlatform,
    type RuntimeHandle,
    type ExecutionHandle,
    type Invocation,
    type Provider,
    type LogFilter,
    type ReportCallback,
    type EventRecorder,
    type PlatformInfo,
    type SecureFetchOptions,
    type TranslationMessages,
    type LoggerFactory,
    type FeatureFlagsProvider,
    type LocaleAttributes,
    type Translator,
    type Storage,
    type Token,
    type Logger,
} from "@finesoft/core";
import { getWebPlan, WEB_EXECUTION } from "./definition";
import type { WebAppDefinition } from "./types";
import { PrefetchedIntents } from "../prefetched-intents/prefetched-intents";

export interface WebConfiguration {
    readonly fetch?: typeof globalThis.fetch;
    readonly locale?: string;
    readonly platform?: PlatformInfo;
    readonly safeFetch?: SecureFetchOptions;
    readonly logFilter?: LogFilter;
    readonly reportCallback?: ReportCallback;
    readonly eventRecorder?: EventRecorder;
    readonly featureFlags?: Readonly<Record<string, boolean | string | number>>;
    readonly featureFlagsProviders?: readonly FeatureFlagsProvider[];
    /** Keep browser defaults shared; SSR supplies execution for request-local memory storage. */
    readonly storageScope?: "runtime" | "execution";
}
export interface WebRuntimeOptions<
    Definition extends WebAppDefinition = WebAppDefinition,
> extends WebConfiguration {
    readonly definition: Definition;
    readonly runtime?: RuntimeHandle;
    readonly invocation?: Invocation;
    readonly prefetchedIntents?: PrefetchedIntents;
    readonly messages?: TranslationMessages;
    /** Host-resolved attributes used by the default locale provider. */
    readonly localeAttributes?: LocaleAttributes;
}
const SERVICES = "@finesoft/web/services";
class MissingWebServiceError extends ExecutionError {}
interface Services {
    fetch: typeof globalThis.fetch;
    locale?: LocaleAttributes;
    translator?: Translator;
    safeFetch?: SecureFetchOptions;
}
export function createWebRuntime<Definition extends WebAppDefinition>(
    input: WebRuntimeOptions<Definition>,
) {
    const config = { ...input.definition.configuration, ...input };
    const plan = getWebPlan(config.definition);
    const prefetchedIntents = config.prefetchedIntents ?? PrefetchedIntents.empty();
    let defaultTranslator: Translator | undefined;
    const getTranslatorForLocale = (locale?: string) => {
        if (!locale) return undefined;
        if (locale === config.locale) {
            if (!defaultTranslator) {
                const messages = config.messages && resolveMessages(config.messages, locale);
                if (messages) defaultTranslator = new SimpleTranslator({ locale, messages });
            }
            return defaultTranslator;
        }
        const messages = config.messages && resolveMessages(config.messages, locale);
        return messages ? new SimpleTranslator({ locale, messages }) : undefined;
    };
    let loggerFactory: LoggerFactory | undefined;
    const getLoggerFactory = () =>
        (loggerFactory ??= config.reportCallback
            ? new CompositeLoggerFactory([
                  new ConsoleLoggerFactory(config.logFilter),
                  new ReportingLoggerFactory({ report: config.reportCallback }),
              ])
            : new ConsoleLoggerFactory(config.logFilter));
    let externalStorage: Storage | undefined;
    const createMemoryStorage = (): Storage => {
        const values = new Map<string, string>();
        return {
            get: (key: string) => values.get(key),
            set: (key: string, value: string) => {
                values.set(key, value);
            },
            delete: (key: string) => {
                values.delete(key);
            },
        };
    };
    const getExternalStorage = () => (externalStorage ??= createMemoryStorage());
    function createDefaultProviders(scopeFallback = false): Provider<any>[] {
        const defaultLifetime = scopeFallback ? "scope" : "runtime";
        const storageLifetime =
            scopeFallback || config.storageScope === "execution" ? "scope" : "runtime";
        return [
            provide({
                token: DEP_KEYS.LOGGER_FACTORY,
                lifetime: defaultLifetime,
                create: getLoggerFactory,
            }),
            provide({
                token: DEP_KEYS.LOGGER,
                lifetime: defaultLifetime,
                dependencies: [DEP_KEYS.LOGGER_FACTORY],
                create: async (c) => (await c.get(DEP_KEYS.LOGGER_FACTORY)).loggerFor("web"),
            }),
            provide({
                token: DEP_KEYS.FETCH,
                lifetime: "scope",
                create: (c) => (c.bindings[SERVICES] as Services).fetch,
            }),
            provide({
                token: DEP_KEYS.SAFE_FETCH,
                lifetime: "scope",
                dependencies: [DEP_KEYS.FETCH],
                create: async (c) =>
                    secureFetch(
                        await c.get(DEP_KEYS.FETCH),
                        (c.bindings[SERVICES] as Services).safeFetch,
                    ),
            }),
            provide({
                token: DEP_KEYS.LOCALE,
                lifetime: "scope",
                create: (c) => {
                    const value = (c.bindings[SERVICES] as Services).locale;
                    if (!value)
                        throw new MissingWebServiceError(
                            "configuration",
                            "Locale is not configured",
                        );
                    return value;
                },
            }),
            provide({
                token: DEP_KEYS.TRANSLATOR,
                lifetime: "scope",
                create: (c) => {
                    const value = (c.bindings[SERVICES] as Services).translator;
                    if (!value)
                        throw new MissingWebServiceError(
                            "configuration",
                            "Messages are not configured",
                        );
                    return value;
                },
            }),
            provide({
                token: DEP_KEYS.PLATFORM,
                lifetime: defaultLifetime,
                create: () => {
                    return config.platform ?? detectPlatform();
                },
            }),
            provide({
                token: DEP_KEYS.EVENT_RECORDER,
                lifetime: defaultLifetime,
                create: () =>
                    scopeFallback && config.eventRecorder
                        ? config.eventRecorder
                        : { record: (type, fields) => runtime.record(type, fields) },
            }),
            provide({
                token: DEP_KEYS.STORAGE,
                lifetime: storageLifetime,
                create: () => {
                    if (scopeFallback && config.storageScope !== "execution")
                        return getExternalStorage();
                    return createMemoryStorage();
                },
            }),
            provide({
                token: DEP_KEYS.FEATURE_FLAGS,
                lifetime: defaultLifetime,
                create: () => {
                    const providers = [...(config.featureFlagsProviders ?? [])].reverse();
                    return {
                        isEnabled: (key: string) =>
                            providers.some((p) => p.isEnabled(key)) ||
                            config.featureFlags?.[key] === true,
                        getString: (key: string) => {
                            for (const provider of providers) {
                                const value = provider.getString?.(key);
                                if (value !== undefined) return value;
                            }
                            const value = config.featureFlags?.[key];
                            return typeof value === "string" ? value : undefined;
                        },
                        getNumber: (key: string) => {
                            for (const provider of providers) {
                                const value = provider.getNumber?.(key);
                                if (value !== undefined) return value;
                            }
                            const value = config.featureFlags?.[key];
                            return typeof value === "number" ? value : undefined;
                        },
                    };
                },
            }),
        ];
    }
    function createOwnedRuntime(): RuntimeHandle {
        const defaults = createDefaultProviders();
        const supplied = new Set(
            [
                ...(plan.app.providers ?? []),
                ...(plan.app.modules ?? []).flatMap((m) => m.providers ?? []),
            ].map((p) => p.token),
        );
        return createRuntime({
            app: defineApp({
                ...plan.app,
                providers: [
                    ...defaults.filter((p) => !supplied.has(p.token)),
                    ...(plan.app.providers ?? []),
                ],
            }),
            capabilities: { fetch: config.fetch ?? globalThis.fetch?.bind(globalThis) },
            invocationCapabilities: ["fetch"],
            recorder: config.eventRecorder,
        });
    }
    const runtime: RuntimeHandle = config.runtime ?? createOwnedRuntime();
    const externalDefaultProviders = config.runtime ? createDefaultProviders(true) : [];
    const active = new Set<ExecutionHandle>();
    let closed = false,
        disposing: Promise<void> | undefined;
    // Browser view services live until this Web runtime closes. SSR supplies its request execution.
    let viewExecution: ExecutionHandle | undefined;
    const serviceContext = (execution?: ExecutionHandle) =>
        (execution ?? (viewExecution ??= web.createExecution())).context;
    async function optionalService<T>(
        token: Token<T>,
        execution?: ExecutionHandle,
    ): Promise<T | undefined> {
        try {
            return await serviceContext(execution).get(token);
        } catch (error) {
            if (!(error instanceof MissingWebServiceError)) throw error;
            return undefined;
        }
    }
    const web = {
        definition: config.definition,
        router: plan.router,
        runtime,
        prefetchedIntents,
        getLocale: (execution?: ExecutionHandle): Promise<LocaleAttributes | undefined> =>
            optionalService(DEP_KEYS.LOCALE, execution),
        getTranslator: (execution?: ExecutionHandle): Promise<Translator | undefined> =>
            optionalService(DEP_KEYS.TRANSLATOR, execution),
        getLogger: (execution?: ExecutionHandle): Promise<Logger> =>
            serviceContext(execution).get(DEP_KEYS.LOGGER),
        createExecution(invocation: Invocation = {}): ExecutionHandle {
            if (closed) throw new ExecutionError("configuration", "Web runtime is closed");
            const base = config.invocation;
            const signals = [base?.signal, invocation.signal].filter((s): s is AbortSignal => !!s);
            const services = {} as Services;
            const execution = runtime.createExecution({
                ...base,
                ...invocation,
                signal: signals.length ? AbortSignal.any(signals) : undefined,
                locale: invocation.locale ?? base?.locale ?? config.locale,
                fetch: invocation.fetch ?? base?.fetch ?? config.fetch,
                bindings: {
                    ...base?.bindings,
                    ...invocation.bindings,
                    [SERVICES]: services,
                    [WEB_EXECUTION]: {
                        prefetched: prefetchedIntents,
                        retained: new WeakMap(),
                        entryIds: new WeakMap(),
                        contexts: new WeakMap(),
                    },
                },
            });
            for (const provider of externalDefaultProviders) {
                if (!execution.context.container.hasProvider(provider.token))
                    execution.context.container.registerProvider(provider);
            }
            services.fetch = execution.context.fetch;
            services.locale = execution.context.locale
                ? ((execution.context.locale === config.locale
                      ? config.localeAttributes
                      : undefined) ?? getLocaleAttributes(execution.context.locale))
                : undefined;
            Object.defineProperty(services, "translator", {
                get: () => getTranslatorForLocale(execution.context.locale),
            });
            services.safeFetch = config.safeFetch;
            const dispose = execution.dispose.bind(execution);
            execution.dispose = async () => {
                try {
                    await dispose();
                } finally {
                    active.delete(execution);
                }
            };
            active.add(execution);
            return execution;
        },
        dispose(): Promise<void> {
            closed = true;
            return (disposing ??= (async () => {
                const results = await Promise.allSettled([...active].map((e) => e.dispose()));
                if (!config.runtime)
                    results.push(...(await Promise.allSettled([runtime.dispose()])));
                const errors = results.filter((r) => r.status === "rejected").map((r) => r.reason);
                if (errors.length) throw new AggregateError(errors, "Web cleanup failed");
            })());
        },
    };
    return web;
}
export type WebRuntime<Definition extends WebAppDefinition = WebAppDefinition> = ReturnType<
    typeof createWebRuntime<Definition>
>;
