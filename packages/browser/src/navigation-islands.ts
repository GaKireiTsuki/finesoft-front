import {
    collectAllLeaves,
    islandContainerAttributes,
    type NavigationSnapshot,
} from "@finesoft/web";
import type { BrowserRenderer, RenderContext, ViewHandle } from "./renderer";
export function createEntryRenderer({
    outlet,
    renderer,
    context,
}: {
    outlet: HTMLElement;
    renderer: BrowserRenderer;
    context: RenderContext;
}) {
    const mounted = new Map<
        string,
        {
            container: HTMLElement;
            handle: ViewHandle;
            page: NavigationSnapshot["destinations"][number]["page"];
            attached: boolean;
            scroll?: { element: HTMLElement; top: number; left: number }[];
        }
    >();
    let boot = true;
    const emit = (container: HTMLElement, name: string) =>
        container.dispatchEvent(new CustomEvent(name, { bubbles: true }));
    async function remove(key: string) {
        const item = mounted.get(key)!;
        emit(item.container, "fs:exit");
        mounted.delete(key);
        try {
            await item.handle.dispose();
        } finally {
            item.container.remove();
        }
    }
    return {
        outlet,
        async sync(snapshot: NavigationSnapshot) {
            const present = new Set(collectAllLeaves(snapshot.tree).map((entry) => entry.entryId));
            for (const key of mounted.keys()) if (!present.has(key)) await remove(key);
            const ssr = new Map(
                Array.from(outlet.querySelectorAll<HTMLElement>("[data-fs-entry]")).map((el) => [
                    el.getAttribute("data-fs-key"),
                    el,
                ]),
            );
            const visible = new Set(snapshot.destinations.map((entry) => entry.entryId));
            for (const [key, item] of mounted)
                if (!visible.has(key) && item.attached) {
                    item.scroll = [
                        item.container,
                        ...item.container.querySelectorAll<HTMLElement>("[data-fs-scroll]"),
                    ].map((element) => ({
                        element,
                        top: element.scrollTop,
                        left: element.scrollLeft,
                    }));
                    emit(item.container, "fs:conceal");
                    item.container.remove();
                    item.attached = false;
                }
            for (const entry of snapshot.destinations) {
                let item = mounted.get(entry.entryId);
                if (item && item.page.pageType !== entry.page.pageType) {
                    emit(item.container, "fs:reset");
                    await remove(entry.entryId);
                    item = undefined;
                }
                if (!item) {
                    const adopted = boot ? ssr.get(entry.entryId) : undefined;
                    const container = adopted ?? outlet.ownerDocument.createElement("div");
                    for (const [key, value] of Object.entries(
                        islandContainerAttributes(entry.intent, entry.entryId),
                    ))
                        container.setAttribute(key, value);
                    outlet.appendChild(container);
                    const handle = await Promise.resolve()
                        .then(() =>
                            renderer.mount({
                                target: container,
                                page: entry.page,
                                context,
                                hydrate: !!adopted,
                            }),
                        )
                        .catch((error) => {
                            container.remove();
                            throw error;
                        });
                    item = { container, handle, page: entry.page, attached: false };
                    mounted.set(entry.entryId, item);
                    emit(container, "fs:enter");
                } else if (item.page !== entry.page) {
                    await item.handle.update(entry.page);
                    item.page = entry.page;
                }
                outlet.appendChild(item.container);
                if (!item.attached) {
                    emit(item.container, "fs:reveal");
                    for (const position of item.scroll ?? []) {
                        position.element.scrollTop = position.top;
                        position.element.scrollLeft = position.left;
                    }
                }
                item.attached = true;
                ssr.delete(entry.entryId);
            }
            if (boot) for (const el of ssr.values()) el.remove();
            boot = false;
        },
        async dispose() {
            const results = await Promise.allSettled([...mounted.keys()].map(remove));
            const errors = results
                .filter((result) => result.status === "rejected")
                .map((result) => result.reason);
            if (errors.length) throw new AggregateError(errors, "Entry cleanup failed");
        },
    };
}
