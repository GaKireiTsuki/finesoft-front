import type { BrowserAppHandle } from "@finesoft/front/browser";
import type { NavigationSnapshot } from "@finesoft/front/web";
import { useEffect, useState } from "react";
import type { NameStore } from "./instance";
import { getNavigationChrome, TAB_LABELS } from "./lib/navigation";

interface AppProps {
    initialSnapshot?: NavigationSnapshot;
    controller?: BrowserAppHandle;
    nameStore?: NameStore;
}

export default function App({ initialSnapshot, controller, nameStore }: AppProps) {
    const { tabs, canGoBack } = getNavigationChrome(initialSnapshot);
    // Start empty on both server and client; restore the profile after hydration.
    const [name, setName] = useState("");
    useEffect(() => {
        if (!nameStore) return;
        setName(nameStore.get());
        return nameStore.subscribe(() => setName(nameStore.get()));
    }, [nameStore]);

    return (
        <div className="app-chrome">
            <header className="profile">
                <label>
                    Your name (global):
                    <input
                        value={name}
                        placeholder="anon"
                        onChange={(event) => nameStore?.set(event.target.value)}
                        onBlur={() => controller?.session?.save()}
                    />
                </label>
                {name && <span>👋 {name}</span>}
            </header>
            {tabs && (
                <nav className="tabs" aria-label="Pages">
                    {tabs.order.map((key) => (
                        <button
                            key={key}
                            aria-current={key === tabs.active}
                            onClick={() => void controller?.navigation?.selectTab(key)}
                        >
                            {TAB_LABELS[key] ?? key}
                        </button>
                    ))}
                </nav>
            )}
            {canGoBack && (
                <button onClick={() => void controller?.navigation?.pop()}>← Back</button>
            )}
        </div>
    );
}
