import { Outlet, useSnapshot, type WebAppView } from "@finesoft/front/react";
import { useLayoutEffect, useRef, useState } from "react";
import { TAB_LABELS } from "./lib/navigation";
import { views } from "./views";
export default function App({ app }: { readonly app: WebAppView }) {
    const snapshot = useSnapshot(app);
    // Start empty on both server and client; restore the profile after hydration.
    const [name, setName] = useState("");
    const current = useRef(name);
    current.current = name;
    useLayoutEffect(() => {
        return app.session?.register({
            key: "profile",
            version: 1,
            decode: (data) => {
                if (
                    !data ||
                    typeof data !== "object" ||
                    typeof (data as { name?: unknown }).name !== "string"
                )
                    throw Error("invalid-profile-state");
                return data as { name: string };
            },
            capture: () => ({ name: current.current }),
            restore: (data) => setName(data.name),
        });
    }, [app]);

    return (
        <div className="app-chrome">
            <header className="profile">
                <label>
                    Your name (global):
                    <input
                        value={name}
                        placeholder="anon"
                        onChange={(event) => setName(event.target.value)}
                        onBlur={() => void app.session?.save()}
                    />
                </label>
                {name && <span>👋 {name}</span>}
            </header>
            {snapshot.navigation.tabs && (
                <nav className="tabs" aria-label="Pages">
                    {snapshot.navigation.tabs.order.map((key) => (
                        <button
                            key={key}
                            aria-current={key === snapshot.navigation.tabs?.active}
                            onClick={() => void app.navigation.selectTab(key)}
                        >
                            {TAB_LABELS[key] ?? key}
                        </button>
                    ))}
                </nav>
            )}
            {snapshot.navigation.canGoBack && (
                <button onClick={() => void app.navigation.pop()}>← Back</button>
            )}
            <Outlet app={app} views={views} />
        </div>
    );
}
