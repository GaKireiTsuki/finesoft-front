import { useState } from "react";
import type { Action } from "@finesoft/front";
import { KeepAliveOutlet, onActivate, onDeactivate } from "@finesoft/front/react";
import type { AboutPage } from "../lib/models/product";

interface AboutProps {
    page: AboutPage;
    onAction?: (action: Action) => void;
}

const EMPTY_OUTLET_PROPS = {};

export default function About({ page }: AboutProps) {
    const [activationCount, setActivationCount] = useState(0);
    const [deactivationCount, setDeactivationCount] = useState(0);
    const [draft, setDraft] = useState("");
    const [activeTab, setActiveTab] = useState<"overview" | "notes">("overview");

    onActivate(() => {
        setActivationCount((count) => count + 1);
    });

    onDeactivate(() => {
        setDeactivationCount((count) => count + 1);
    });

    const tabs = {
        overview: AboutOverviewTab,
        notes: AboutNotesTab,
    } as const;
    const ActiveTab = tabs[activeTab];

    return (
        <div style={{ display: "grid", gap: "1rem" }}>
            <h1>{page.title}</h1>
            <p>{page.content}</p>

            <section style={{ border: "1px solid #eee", borderRadius: "0.75rem", padding: "1rem" }}>
                <h2>Page keep alive</h2>
                <p>Activate: {activationCount}</p>
                <p>Deactivate: {deactivationCount}</p>
                <label style={{ display: "grid", gap: "0.5rem", maxWidth: "24rem" }}>
                    Draft message
                    <input value={draft} onChange={(event) => setDraft(event.target.value)} />
                </label>
            </section>

            <section style={{ border: "1px solid #eee", borderRadius: "0.75rem", padding: "1rem" }}>
                <h2>KeepAlive outlet</h2>
                <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
                    <button type="button" onClick={() => setActiveTab("overview")}>
                        Overview tab
                    </button>
                    <button type="button" onClick={() => setActiveTab("notes")}>
                        Notes tab
                    </button>
                </div>
                <KeepAliveOutlet
                    cacheKey={activeTab}
                    component={ActiveTab}
                    componentProps={EMPTY_OUTLET_PROPS}
                />
            </section>
        </div>
    );
}

function AboutOverviewTab() {
    const [text, setText] = useState("");
    const [activationCount, setActivationCount] = useState(0);

    onActivate(() => {
        setActivationCount((count) => count + 1);
    });

    return (
        <div style={{ display: "grid", gap: "0.5rem" }}>
            <p>Overview activations: {activationCount}</p>
            <label style={{ display: "grid", gap: "0.5rem", maxWidth: "24rem" }}>
                Overview note
                <input value={text} onChange={(event) => setText(event.target.value)} />
            </label>
        </div>
    );
}

function AboutNotesTab() {
    const [count, setCount] = useState(0);
    const [activationCount, setActivationCount] = useState(0);

    onActivate(() => {
        setActivationCount((value) => value + 1);
    });

    return (
        <div style={{ display: "grid", gap: "0.5rem" }}>
            <p>Notes activations: {activationCount}</p>
            <p>Counter: {count}</p>
            <button type="button" onClick={() => setCount((value) => value + 1)}>
                Increment
            </button>
        </div>
    );
}
