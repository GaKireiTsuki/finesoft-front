import { createApp, createSSRApp, h, shallowRef, nextTick, type Component } from "vue";
import type { BrowserRenderer } from "@finesoft/browser";
import { selectView, viewProps, type RendererOptions } from "../types";
export function createVueRenderer(options: RendererOptions<Component>): BrowserRenderer {
    const make =
        (chrome = false): BrowserRenderer["mount"] =>
        async ({ target, page, context, hydrate }) => {
            const state = shallowRef(page);
            const Root = {
                setup: () => () => {
                    const props = viewProps(state.value, context);
                    return h(chrome ? options.chrome! : selectView(options, state.value), {
                        ...props,
                        ...options.props?.(props),
                    });
                },
            };
            const app = (hydrate ? createSSRApp : createApp)(Root);
            try {
                app.mount(target);
                await nextTick();
            } catch (error) {
                app.unmount();
                throw error;
            }
            return {
                async update(page) {
                    state.value = page;
                    await nextTick();
                },
                dispose() {
                    app.unmount();
                },
            };
        };
    return {
        mode: options.mode,
        mount: make(),
        mountChrome: options.chrome ? make(true) : undefined,
    };
}
