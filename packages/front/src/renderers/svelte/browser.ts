import { mount, hydrate, unmount, tick, type Component } from "svelte";
import { writable, fromStore } from "svelte/store";
import type { BrowserRenderer } from "@finesoft/browser";
import { selectView, viewProps, type RendererOptions } from "../types";
export function createSvelteRenderer(options: RendererOptions<Component<any>>): BrowserRenderer {
    const make =
        (chrome = false): BrowserRenderer["mount"] =>
        async ({ target, page, context, hydrate: shouldHydrate }) => {
            let View = chrome ? options.chrome! : selectView(options, page);
            const store = writable(page),
                state = fromStore(store);
            const initial = viewProps(page, context);
            const props: Record<string, unknown> = {};
            for (const key of Object.keys({ ...initial, ...options.props?.(initial) }))
                Object.defineProperty(props, key, {
                    enumerable: true,
                    get() {
                        const value = viewProps(state.current, context);
                        return { ...value, ...options.props?.(value) }[key as keyof typeof value];
                    },
                });
            let app = (shouldHydrate ? hydrate : mount)(View, { target, props });
            try {
                await tick();
            } catch (error) {
                await unmount(app);
                throw error;
            }
            return {
                async update(page) {
                    const next = chrome ? options.chrome! : selectView(options, page);
                    if (next !== View) {
                        await unmount(app);
                        View = next;
                        store.set(page);
                        app = mount(View, { target, props });
                    } else store.set(page);
                    await tick();
                },
                async dispose() {
                    await unmount(app);
                },
            };
        };
    return {
        mode: options.mode,
        mount: make(),
        mountChrome: options.chrome ? make(true) : undefined,
    };
}
