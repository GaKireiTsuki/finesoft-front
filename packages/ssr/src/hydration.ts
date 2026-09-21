import { parse, type DefaultTreeAdapterMap } from "parse5";
import { createHydrationDigest } from "@finesoft/web";

type Node = DefaultTreeAdapterMap["node"];

/** Fingerprint the data script's container, using the same HTML parsing rules as browsers. */
export function stampHydrationDOM(html: string): string {
    if (!html.includes("data-fs-server-data")) return html;
    const document = parse(html, { sourceCodeLocationInfo: true });
    const stamps: { offset: number; digest: string }[] = [];
    function visit(node: Node) {
        if (!("childNodes" in node)) return;
        for (const child of node.childNodes) {
            if (
                "tagName" in child &&
                child.tagName === "script" &&
                child.attrs.some((attribute) => attribute.name === "data-fs-server-data") &&
                child.sourceCodeLocation?.startTag
            ) {
                const digest = createHydrationDigest();
                const write = (item: Node) => {
                    if (
                        "tagName" in item &&
                        item.tagName === "script" &&
                        item.attrs.some((attribute) => attribute.name === "data-fs-server-data")
                    )
                        return;
                    if (item.nodeName === "#text") {
                        digest.write("text");
                        digest.write((item as DefaultTreeAdapterMap["textNode"]).value);
                    } else if (item.nodeName === "#comment") {
                        digest.write("comment");
                        digest.write((item as DefaultTreeAdapterMap["commentNode"]).data);
                    } else if ("tagName" in item) {
                        digest.write("element");
                        digest.write(item.namespaceURI);
                        digest.write(item.tagName);
                        if (item.tagName.includes("-")) {
                            digest.write("opaque");
                            return;
                        }
                        const attributes = item.attrs.map((attribute) => ({
                            name: attribute.prefix
                                ? `${attribute.prefix}:${attribute.name}`
                                : attribute.name,
                            value: attribute.value,
                        }));
                        for (const attribute of attributes.sort((a, b) =>
                            a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
                        )) {
                            digest.write(attribute.name);
                            digest.write(attribute.value);
                        }
                        digest.write("children");
                        const children =
                            item.tagName === "template"
                                ? (item as DefaultTreeAdapterMap["template"]).content.childNodes
                                : item.childNodes;
                        for (const descendant of children) write(descendant);
                        digest.write("end");
                    }
                };
                for (const sibling of node.childNodes) write(sibling);
                stamps.push({
                    offset: child.sourceCodeLocation.startTag.endOffset - 1,
                    digest: digest.value(),
                });
            }
            visit(child);
        }
    }
    visit(document);
    // Do not reserialize the HTML: native renderer markers and custom elements stay byte-for-byte.
    for (const { offset, digest } of stamps.sort((a, b) => b.offset - a.offset))
        html = `${html.slice(0, offset)} data-fs-dom="${digest}"${html.slice(offset)}`;
    return html;
}
