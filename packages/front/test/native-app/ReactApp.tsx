import { useState } from "react";
import { Outlet, type WebAppView } from "@finesoft/front/react";
import Other from "./ReactOther.tsx";
import Probe from "./ReactProbe.tsx";
import { NativeLocaleContext } from "./ReactContext";

export default function ReactApp({ app }: { app: WebAppView }) {
    const [locale, setLocale] = useState(app.locale?.lang ?? "missing");
    return (
        <NativeLocaleContext.Provider value={locale}>
            <button data-context-update onClick={() => setLocale((value) => value + ":updated")}>
                Update context
            </button>
            <Outlet app={app} views={{ probe: Probe, other: Other }} />
        </NativeLocaleContext.Provider>
    );
}
