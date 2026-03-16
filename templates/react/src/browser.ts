import { startBrowserApp } from "@finesoft/front";
import { createElement, useState } from "react";
import { hydrateRoot } from "react-dom/client";
import App from "./App";
import { bootstrap } from "./lib/bootstrap";

// External setter so `mount` can push updates into React
let setAppProps: ((props: Record<string, unknown>) => void) | undefined;

function Root({ locale, framework }: { locale: string; framework: unknown }) {
    const [props, setProps] = useState<Record<string, unknown>>({});
    setAppProps = setProps;
    return createElement(App, { ...props, locale, framework } as any);
}

void startBrowserApp({
    bootstrap,
    defaultLocale: "en",
    mount: (target, { framework, locale }) => {
        hydrateRoot(target, createElement(Root, { locale, framework } as any));

        return (props) => {
            setAppProps?.(props as any);
        };
    },
    callbacks: {
        onNavigate(pathname) {
            console.log("navigate:", pathname);
        },
        onModal(page) {
            console.log("modal:", page);
        },
    },
});
