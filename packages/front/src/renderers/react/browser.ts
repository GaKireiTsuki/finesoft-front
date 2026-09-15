import { createElement, useLayoutEffect, type ComponentType } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import type { BrowserRenderer } from "@finesoft/browser";
import { selectView, viewProps, type RendererOptions } from "../types";
export function createReactRenderer(options: RendererOptions<ComponentType<any>>): BrowserRenderer {
    const make =
        (chrome = false): BrowserRenderer["mount"] =>
        async ({ target, page, context, hydrate }) => {
            let root: Root;
            let rejectCommit: (reason: unknown) => void;
            const element = (ready: () => void) => {
                const props = viewProps(page, context);
                const View = chrome ? options.chrome! : selectView(options, page);
                function Ready() {
                    useLayoutEffect(ready, []);
                    return null;
                }
                return createElement(
                    "div",
                    { style: { display: "contents" } },
                    createElement(View, { ...props, ...options.props?.(props) }),
                    createElement(Ready),
                );
            };
            await new Promise<void>((resolve, reject) => {
                rejectCommit = reject;
                try {
                    if (hydrate)
                        root = hydrateRoot(target, element(resolve), {
                            onUncaughtError: (error) => rejectCommit(error),
                        });
                    else {
                        root = createRoot(target, {
                            onUncaughtError: (error) => rejectCommit(error),
                        });
                        flushSync(() => root.render(element(resolve)));
                    }
                } catch (error) {
                    reject(error);
                }
            }).catch((error) => {
                root?.unmount();
                throw error;
            });
            return {
                async update(next) {
                    page = next;
                    await new Promise<void>((resolve, reject) => {
                        rejectCommit = reject;
                        flushSync(() => root.render(element(resolve)));
                    });
                },
                dispose() {
                    root.unmount();
                },
            };
        };
    return {
        mode: options.mode,
        mount: make(),
        mountChrome: options.chrome ? make(true) : undefined,
    };
}
