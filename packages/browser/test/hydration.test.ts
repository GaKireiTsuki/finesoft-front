import { expect, test } from "vite-plus/test";
import { digestHydrationDOM, inspectHydration } from "../src/hydration";

function fixture() {
    const attributes = [{ name: "class", value: "server" }];
    const elements: HTMLElement[] = [];
    const document = { activeElement: null, getSelection: () => null };
    const target = {
        ownerDocument: document,
        scrollTop: 0,
        scrollLeft: 0,
        hasChildNodes: () => true,
        getAttributeNames: () => [],
        closest: () => target,
        querySelectorAll: () => elements,
        childNodes: elements,
        contains: (element: unknown) => elements.includes(element as HTMLElement),
    } as unknown as HTMLElement;
    function element(tag: string, properties: Record<string, unknown> = {}) {
        const node = {
            nodeType: 1,
            namespaceURI: "http://www.w3.org/1999/xhtml",
            localName: tag,
            attributes: [],
            childNodes: [],
            matches: () => false,
            tagName: tag.toUpperCase(),
            getAttributeNames: () => [],
            hasAttribute: () => false,
            closest: () => target,
            ...properties,
        } as unknown as HTMLElement;
        elements.push(node);
        return node;
    }
    const injected = element("div", { attributes });
    const expected = digestHydrationDOM(target);
    attributes.push({ name: "data-unknown-tool", value: "injected" });
    return { target, injected, element, document, expected };
}

test("legacy SSR and unavailable server data keep their native startup paths", () => {
    const { target, expected } = fixture();
    expect(inspectHydration(target, true)).toEqual({ shouldHydrate: true });
    expect(inspectHydration(target, false, expected)).toEqual({ shouldHydrate: false });
    expect(inspectHydration(target, true, "v2:unknown")).toEqual({ shouldHydrate: true });
});

test("changed markup selects a fresh native root without mutating DOM", () => {
    const { target, injected, expected } = fixture();
    expect(inspectHydration(target, true, expected)).toEqual({
        shouldHydrate: false,
        changedDOM: true,
    });
    expect([...injected.attributes].map((attribute) => attribute.name)).toEqual([
        "class",
        "data-unknown-tool",
    ]);
});

test("matching markup hydrates; the container's own attributes are not renderer-owned", () => {
    const { target } = fixture();
    const expected = digestHydrationDOM(target);
    Object.assign(target, { attributes: [{ name: "data-unknown-host", value: "new" }] });
    expect(inspectHydration(target, true, expected)).toEqual({ shouldHydrate: true });
});

test.each([
    ["input", { type: "text", value: "draft", defaultValue: "" }],
    ["input", { type: "password", value: "private", defaultValue: "" }],
    ["input", { type: "checkbox", checked: true, defaultChecked: false }],
    ["input", { type: "file", value: "", defaultValue: "", files: [{}] }],
    ["textarea", { value: "draft", defaultValue: "" }],
    ["select", { options: [], selectedIndex: 1, multiple: false }],
    ["div", { isContentEditable: true }],
    ["div", { scrollTop: 100 }],
    ["details", { open: true }],
    ["details", { open: false }],
    ["iframe", {}],
    ["canvas", {}],
    ["div", { shadowRoot: {} }],
    ["video", { paused: false, currentTime: 1 }],
    ["custom-input", {}],
    ["div", { hasAttribute: (name: string) => name === "data-fs-app" }],
])("keeps browser-owned state in %s", (tag, properties) => {
    const { target, element, expected } = fixture();
    element(tag, properties);
    expect(inspectHydration(target, true, expected)).toEqual({
        shouldHydrate: true,
        changedDOM: true,
    });
});

test("untouched text and checkbox controls allow recovery", () => {
    const { target, element, expected } = fixture();
    element("input", { type: "text", value: "initial", defaultValue: "initial" });
    element("input", {
        type: "checkbox",
        value: "on",
        defaultValue: "",
        checked: false,
        defaultChecked: false,
    });
    expect(inspectHydration(target, true, expected).shouldHydrate).toBe(false);
});

test("focus, selected text and root scroll keep existing DOM", () => {
    const { target, element, document, expected } = fixture();
    const input = element("button");
    Object.assign(document, { activeElement: input });
    expect(inspectHydration(target, true, expected).shouldHydrate).toBe(true);
    Object.assign(document, {
        activeElement: null,
        getSelection: () => ({ isCollapsed: false, anchorNode: input }),
    });
    expect(inspectHydration(target, true, expected).shouldHydrate).toBe(true);
    Object.assign(document, { getSelection: () => null });
    target.scrollTop = 100;
    expect(inspectHydration(target, true, expected).shouldHydrate).toBe(true);
    target.scrollTop = 0;
    Object.assign(document, { defaultView: { scrollY: 100 } });
    expect(inspectHydration(target, true, expected).shouldHydrate).toBe(true);
});
