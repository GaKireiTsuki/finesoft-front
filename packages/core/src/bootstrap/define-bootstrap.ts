import type { Framework, FrameworkConfig } from "../framework";
import type { MessagesLoader } from "../i18n/messages";

export interface BootstrapRuntimeConfig {
    frameworkConfig?: Omit<FrameworkConfig, "prefetchedIntents">;
    loadMessages?: MessagesLoader;
}

export type FrameworkBootstrap = (framework: Framework) => void;

const BOOTSTRAP_CONFIG = Symbol.for("@finesoft/bootstrap-config");

type ConfiguredBootstrap = FrameworkBootstrap & {
    [BOOTSTRAP_CONFIG]?: BootstrapRuntimeConfig;
};

export function defineBootstrap(
    config: BootstrapRuntimeConfig,
    bootstrap: FrameworkBootstrap,
): FrameworkBootstrap {
    const configuredBootstrap = bootstrap as ConfiguredBootstrap;
    configuredBootstrap[BOOTSTRAP_CONFIG] = config;
    return configuredBootstrap;
}

export function getBootstrapConfig(bootstrap: FrameworkBootstrap): BootstrapRuntimeConfig {
    const configuredBootstrap = bootstrap as ConfiguredBootstrap;
    return configuredBootstrap[BOOTSTRAP_CONFIG] ?? {};
}
