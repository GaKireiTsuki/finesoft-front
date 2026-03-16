import type { Framework } from "@finesoft/front";
import { useEffect, useState } from "react";
import type { ErrorPage, Page } from "./lib/models/page";

interface AppProps {
    page: Promise<Page> | Page;
    isFirstPage?: boolean;
    locale?: string;
    framework?: Framework;
}

function getMessage(page: Page): string {
    return page.pageType === "home" ? page.body : page.errorMessage;
}

export default function App({ page, isFirstPage, locale = "en", framework }: AppProps) {
    const [resolved, setResolved] = useState<Page | null>(page instanceof Promise ? null : page);

    useEffect(() => {
        if (page instanceof Promise) {
            setResolved(null);
            page.then((p) => setResolved(p)).catch((err) => {
                const errorPage: ErrorPage = {
                    id: "page-error-runtime",
                    pageType: "error",
                    title: "Error",
                    errorMessage: err instanceof Error ? err.message : "Failed to load page",
                    statusCode: 500,
                };
                setResolved(errorPage);
            });
        } else {
            setResolved(page);
        }
    }, [page]);

    if (!resolved) {
        return (
            <main>
                <h1>Loading...</h1>
                <p>{isFirstPage ? "Preparing first page" : "Navigating"}</p>
            </main>
        );
    }

    return (
        <main>
            <p>locale: {locale}</p>
            <h1>{resolved.title}</h1>
            <p>{getMessage(resolved)}</p>

            <nav>
                <a href="/">Home</a>
            </nav>

            {framework && <p>Framework is available on the client.</p>}
        </main>
    );
}
