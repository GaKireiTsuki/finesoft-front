import type { Framework } from "@finesoft/front/web";

/** Both SSR and hydrated views read the translator from their own application. */
export function getHomeLocale(framework?: Framework) {
    const translator = framework?.getTranslator();
    return {
        lang: framework?.getLocale()?.lang ?? "unknown",
        label: translator?.t("home.localeLabel") ?? "Current locale",
        badge:
            translator?.t("home.runtimeBadge") ??
            "Hydration kept the translator alive on the client.",
        hint:
            translator?.t("home.switchHint") ??
            "Change frameworkConfig.locale in src/app-definition.ts to load another JSON file.",
    };
}
