import { useEffect, useState } from "react";
export default function Probe({
    page,
    initialSnapshot,
}: {
    page: { title: string };
    initialSnapshot?: { destinations: readonly { page: { title?: string } }[] };
}) {
    const [draft, setDraft] = useState("");
    useEffect(
        () => () => {
            (globalThis as any).cleanups = ((globalThis as any).cleanups ?? 0) + 1;
        },
        [],
    );
    return (
        <section
            data-restore-root
            data-snapshot-title={initialSnapshot?.destinations.at(-1)?.page.title ?? "empty"}
        >
            <h1>{page.title}</h1>
            <input name="draft" value={draft} onChange={(e) => setDraft(e.target.value)} />
            <span>{draft}</span>
        </section>
    );
}
