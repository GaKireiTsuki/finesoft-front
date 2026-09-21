import { createHydrationDigest } from "@finesoft/web";

/** Inspect renderer children only; host attributes and the rest of the document are independent. */
export function digestHydrationDOM(target: HTMLElement): string {
    const digest = createHydrationDigest();
    function write(node: Node) {
        if (node.nodeType === 3 || node.nodeType === 8) {
            digest.write(node.nodeType === 3 ? "text" : "comment");
            digest.write(node.nodeValue ?? "");
        } else if (node.nodeType === 1) {
            const element = node as HTMLElement;
            if (element.matches("script[data-fs-server-data]")) return;
            digest.write("element");
            digest.write(element.namespaceURI ?? "");
            digest.write(element.localName);
            // Custom element upgrades own their host attributes and internals independently.
            if (element.localName.includes("-")) {
                digest.write("opaque");
                return;
            }
            for (const attribute of [...element.attributes].sort((a, b) =>
                a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
            )) {
                digest.write(attribute.name);
                digest.write(attribute.name === "nonce" ? element.nonce : attribute.value);
            }
            digest.write("children");
            const parent =
                element.localName === "template"
                    ? (element as HTMLTemplateElement).content
                    : element;
            for (const child of parent.childNodes) write(child);
            digest.write("end");
        }
    }
    for (const child of target.childNodes) write(child);
    return digest.value();
}

/** Decide how to attach a native root without guessing which script modified it. */
export function inspectHydration(
    target: HTMLElement,
    serverReady: boolean,
    expected?: string | null,
) {
    if (!serverReady || !target.hasChildNodes()) return { shouldHydrate: false };

    if (!expected?.startsWith("v1:") || digestHydrationDOM(target) === expected)
        return { shouldHydrate: true };

    // Replacing an already edited/focused document could lose browser state.
    // In that case keep native hydration, including its mismatch diagnostics.
    const document = target.ownerDocument;
    const selection = document.getSelection();
    const preserve =
        !!document.defaultView?.scrollX ||
        !!document.defaultView?.scrollY ||
        (document.activeElement !== target && target.contains(document.activeElement)) ||
        (selection && !selection.isCollapsed && target.contains(selection.anchorNode)) ||
        target.scrollTop !== 0 ||
        target.scrollLeft !== 0 ||
        [...target.querySelectorAll<HTMLElement>("*")].some((element) => {
            // Independent apps and custom elements can own opaque state.
            if (
                element.localName.includes("-") ||
                element.hasAttribute("data-fs-app") ||
                element.shadowRoot
            )
                return true;
            if (element.isContentEditable || element.scrollTop || element.scrollLeft) return true;
            switch (element.tagName) {
                case "INPUT": {
                    const input = element as HTMLInputElement;
                    return input.type === "checkbox" || input.type === "radio"
                        ? input.checked !== input.defaultChecked
                        : input.value !== input.defaultValue || !!input.files?.length;
                }
                case "TEXTAREA": {
                    const input = element as HTMLTextAreaElement;
                    return input.value !== input.defaultValue;
                }
                case "SELECT": {
                    const input = element as HTMLSelectElement;
                    const options = [...input.options];
                    return options.some((option) => option.defaultSelected)
                        ? options.some((option) => option.selected !== option.defaultSelected)
                        : input.multiple
                          ? input.selectedIndex !== -1
                          : input.selectedIndex > 0;
                }
                case "DETAILS":
                case "IFRAME":
                case "OBJECT":
                case "EMBED":
                case "CANVAS":
                    // Reflected state and opaque child contexts have no reliable initial-value comparison.
                    return true;
                case "AUDIO":
                case "VIDEO": {
                    const media = element as HTMLMediaElement;
                    return !media.paused || media.currentTime !== 0;
                }
                default:
                    return false;
            }
        });
    return { shouldHydrate: !!preserve, changedDOM: true };
}
