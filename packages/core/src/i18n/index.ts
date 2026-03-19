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
    setHtmlLocaleAttributes,
} from "./locale";
export { SimpleTranslator, type SimpleTranslatorOptions } from "./translator";
export type { LocaleAttributes, LocaleInfo, TextDirection, Translator } from "./types";
