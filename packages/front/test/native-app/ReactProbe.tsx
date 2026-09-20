import { useContext, useEffect, useState } from "react";
import { NativeLocaleContext } from "./ReactContext";
export default function Probe({
    page,
    app,
}: {
    page: { title: string };
    app: { getSnapshot(): { entries: readonly { page: { title?: string } }[] } };
}) {
    const [draft, setDraft] = useState("");
    const locale = useContext(NativeLocaleContext) ?? "missing";
    useEffect(
        () => () => {
            (globalThis as any).cleanups = ((globalThis as any).cleanups ?? 0) + 1;
        },
        [],
    );
    return (
        <section
            data-restore-root
            data-snapshot-title={app.getSnapshot().entries.at(-1)?.page.title ?? "empty"}
            data-context-locale={locale}
        >
            <h1>{page.title}</h1>
            <input name="draft" value={draft} onChange={(e) => setDraft(e.target.value)} />
            <span>{draft}</span>
        </section>
    );
}
