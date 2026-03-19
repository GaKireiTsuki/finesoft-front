// ===== i18n =====
export {
    englishPlural,
    interpolate,
    resolvePluralKey,
    type PluralCategory,
    type PluralRuleProvider,
} from "./interpolate";
export {
    getLocaleAttributes,
    getTextDirection,
    isRtl,
    makeLocaleInfo,
    resolveLocaleFromUrl,
    setHtmlLocaleAttributes,
} from "./locale";
export {
    resolveConfiguredMessages,
    resolveMessages,
    type MessagesLoader,
    type MessagesLoaderContext,
    type TranslationMessages,
} from "./messages";
export { SimpleTranslator, type SimpleTranslatorOptions } from "./translator";
export type { LocaleAttributes, LocaleInfo, TextDirection, Translator } from "./types";
