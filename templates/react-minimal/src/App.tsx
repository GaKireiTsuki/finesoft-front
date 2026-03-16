import type { BasePage } from "@finesoft/front";
import { useEffect, useState } from "react";

export default function App({ initialPage }: { initialPage?: BasePage | null }) {
    const [page, setPage] = useState<BasePage | null>(initialPage ?? null);

    // Expose updater on window for framework navigation updates (client-only)
    useEffect(() => {
        (window as unknown as { __updateApp?: (page: BasePage) => void }).__updateApp = (
            newPage: BasePage,
        ) => {
            setPage(newPage);
        };
        return () => {
            (window as unknown as { __updateApp?: (page: BasePage) => void }).__updateApp =
                undefined;
        };
    }, []);

    if (!page) return null;

    return (
        <main>
            <h1>{page.title}</h1>
            <p>{page.description}</p>
        </main>
    );
}
