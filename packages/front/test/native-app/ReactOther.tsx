import { useEffect, useState } from "react";
export default function Probe({ page }: { page: { title: string }; framework?: unknown }) {
    const [draft, setDraft] = useState("");
    useEffect(
        () => () => {
            (globalThis as any).cleanups = ((globalThis as any).cleanups ?? 0) + 1;
        },
        [],
    );
    return (
        <section data-restore-root>
            <h1>{page.title}</h1>
            <input name="draft" value={draft} onChange={(e) => setDraft(e.target.value)} />
            <span>{draft}</span>
        </section>
    );
}
