import type { MessagesLoader, MessagesLoaderContext, TranslationMessages } from "./messages";

interface GeneratedMessagesLoaderModule {
    loadMessages?: MessagesLoader;
}

declare const __FINESOFT_I18N_LOADER_MODULE__: string | undefined;

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

    if (typeof __FINESOFT_I18N_LOADER_MODULE__ !== "string") {
        return undefined;
    }

    try {
        const module = (await import(
            __FINESOFT_I18N_LOADER_MODULE__
        )) as GeneratedMessagesLoaderModule;

        if (typeof module.loadMessages !== "function") {
            return undefined;
        }

        globalThis.__FINESOFT_I18N_LOADER__ = module.loadMessages;
        return module.loadMessages;
    } catch {
        return undefined;
    }
}
