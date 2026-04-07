import type { MessagesLoader, MessagesLoaderContext, TranslationMessages } from "./messages";

interface GeneratedMessagesLoaderModule {
    loadMessages?: MessagesLoader;
}

declare const __FINESOFT_I18N_LOADER_SPECIFIER__: string | undefined;

declare global {
    var __FINESOFT_I18N_LOADER__: MessagesLoader | undefined;
}

export async function resolveGeneratedMessages(
    locale: string | undefined,
    context: MessagesLoaderContext | undefined,
): Promise<TranslationMessages | undefined> {
    if (!locale || !context) {
        return undefined;
    }

    const loader = await getGeneratedMessagesLoader();
    if (!loader) {
        return undefined;
    }

    return loader(locale, context);
}

async function getGeneratedMessagesLoader(): Promise<MessagesLoader | undefined> {
    if (typeof globalThis.__FINESOFT_I18N_LOADER__ === "function") {
        return globalThis.__FINESOFT_I18N_LOADER__;
    }

    if (typeof __FINESOFT_I18N_LOADER_SPECIFIER__ !== "string") {
        return undefined;
    }

    try {
        const imported = (await import(__FINESOFT_I18N_LOADER_SPECIFIER__)) as
            | GeneratedMessagesLoaderModule
            | MessagesLoader
            | undefined;
        const loader =
            typeof imported === "function"
                ? imported
                : typeof imported?.loadMessages === "function"
                  ? imported.loadMessages
                  : undefined;

        if (!loader) {
            return undefined;
        }

        globalThis.__FINESOFT_I18N_LOADER__ = loader;
        return loader;
    } catch {
        return undefined;
    }
}
