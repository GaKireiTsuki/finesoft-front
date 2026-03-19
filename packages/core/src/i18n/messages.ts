/**
 * i18n message helpers shared by SSR and browser startup.
 */

import { resolveGeneratedMessages } from "./generated-loader";

/** Flat translation table: key -> localized text */
export type FlatMessages = Record<string, string>;

/** Nested translation value: plain text or pluralized text map */
export type NestedMessageValue = string | Record<string, string>;

/** Locale-grouped translation table */
export type LocaleMessages = Record<string, Record<string, NestedMessageValue>>;

/**
 * Translation message formats supported by the framework:
 * - flat messages for a single locale
 * - locale-grouped messages with optional plural subkeys
 */
export type TranslationMessages = FlatMessages | LocaleMessages;

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

    return resolveGeneratedMessages(locale, context);
}

/**
 * Resolve `TranslationMessages` into the flat map consumed by
 * `SimpleTranslator`.
 */
export function resolveMessages(
    messages: TranslationMessages,
    locale: string,
): Record<string, string> | undefined {
    const entries = Object.entries(messages);
    if (entries.length === 0) return undefined;

    if (typeof entries[0][1] === "string") {
        return messages as FlatMessages;
    }

    const localeMap = messages as LocaleMessages;
    const localeMessages = localeMap[locale];
    if (!localeMessages) return undefined;

    const flat: Record<string, string> = {};
    for (const [key, value] of Object.entries(localeMessages)) {
        if (typeof value === "string") {
            flat[key] = value;
            continue;
        }

        for (const [suffix, text] of Object.entries(value)) {
            flat[`${key}.${suffix}`] = text;
        }
    }

    return flat;
}
