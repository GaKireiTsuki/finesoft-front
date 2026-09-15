import type { TranslationMessages } from "@finesoft/core";
export type { TranslationMessages } from "@finesoft/core";
export interface MessagesLoaderContext {
    readonly runtime: "server" | "browser";
    readonly fetch: typeof globalThis.fetch;
    readonly url: string;
    readonly request?: Request;
}

export type MessagesLoader = (
    locale: string,
    context: MessagesLoaderContext,
) => TranslationMessages | Promise<TranslationMessages | undefined> | undefined;

export interface ResolveConfiguredMessagesOptions {
    locale?: string;
    loadMessages?: MessagesLoader;
    context?: MessagesLoaderContext;
}

/**
 * Resolve the effective translation source for a locale.
 */
export async function resolveConfiguredMessages(
    options: ResolveConfiguredMessagesOptions,
): Promise<TranslationMessages | undefined> {
    const { locale, loadMessages, context } = options;

    if (!locale || !context) {
        return undefined;
    }

    if (loadMessages) {
        return loadMessages(locale, context);
    }

    return undefined;
}
