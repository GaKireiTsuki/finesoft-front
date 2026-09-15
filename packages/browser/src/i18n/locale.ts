import type { LocaleAttributes } from "@finesoft/core";
export function setHtmlLocaleAttributes(attrs: LocaleAttributes): void {
    document.documentElement.lang = attrs.lang;
    document.documentElement.dir = attrs.dir;
}
