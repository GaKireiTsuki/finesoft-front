import { useContext, useEffect, useState } from "react";
import { NativeLocaleContext } from "./ReactContext";
export default function Probe({ page }: { page: { title: string }; framework?: unknown }) {
    const [draft, setDraft] = useState("");
    const locale = useContext(NativeLocaleContext) ?? "missing";
    useEffect(
        () => () => {
            (globalThis as any).cleanups = ((globalThis as any).cleanups ?? 0) + 1;
        },
        [],
    );
    return (
        <section data-restore-root data-context-locale={locale}>
            <h1>{page.title}</h1>
            <input name="draft" value={draft} onChange={(e) => setDraft(e.target.value)} />
            <span>{draft}</span>
        </section>
    );
}
