import type { BasePage } from "@finesoft/front";
import { useState } from "react";

export default function App() {
    const [page, setPage] = useState<BasePage | null>(null);

    // Expose updater on window for framework integration
    (window as unknown as { __updateApp?: (page: BasePage) => void }).__updateApp = (
        newPage: BasePage,
    ) => {
        setPage(newPage);
    };

    if (!page) return null;

    return (
        <main>
            <h1>{page.title}</h1>
            <p>{page.description}</p>
        </main>
    );
}
