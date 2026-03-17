import type { Action, BasePage } from "@finesoft/front";

interface AppProps {
    page?: BasePage | null;
    loading?: boolean;
    onAction?: (action: Action) => void;
}

export default function App({ page, loading = false }: AppProps) {
    if (loading)
        return (
            <main style={{ padding: "2rem", textAlign: "center", color: "#999" }}>Loading…</main>
        );
    if (!page) return null;

    return (
        <main style={{ padding: "1rem" }}>
            <h1>{page.title}</h1>
            <p>{page.description}</p>
        </main>
    );
}
