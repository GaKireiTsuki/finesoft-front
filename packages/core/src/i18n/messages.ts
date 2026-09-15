/**
 * i18n message helpers shared by SSR and browser startup.
 */

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
