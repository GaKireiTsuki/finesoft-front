import type { Action, BasePage } from "@finesoft/front";

interface AppProps {
    page?: BasePage | null;
    loading?: boolean;
    onAction?: (action: Action) => void;
}

export default function App({ page, loading = false }: AppProps) {
    if (loading) {
        return (
            <main style={{ padding: "2rem", textAlign: "center", color: "#999" }}>Loading…</main>
        );
    }
    if (!page) return null;

    const anyPage = page as BasePage & {
        email?: string;
        avatarUrl?: string;
    };

    return (
        <main style={{ padding: "1rem", fontFamily: "system-ui, sans-serif" }}>
            <h1>{page.title}</h1>
            <p>{page.description}</p>

            {anyPage.email ? <p>Email: {anyPage.email}</p> : null}
            {anyPage.avatarUrl ? <p>Avatar: {anyPage.avatarUrl}</p> : null}

            {page.id === "home" ? (
                <nav>
                    <h3>Pages</h3>
                    <ul>
                        <li>
                            <a href="/profile/alice">Alice's profile</a>
                        </li>
                        <li>
                            <a href="/search?q=hello">Search</a>
                        </li>
                        <li>
                            <a href="/share?next=https://example.com">Share a link</a>
                        </li>
                        <li>
                            <a href="/image-proxy?url=https://placekitten.com/100/100">
                                Image proxy demo
                            </a>
                        </li>
                        <li>
                            <a href="/static?file=welcome.txt">Static files</a>
                        </li>
                    </ul>
                </nav>
            ) : null}
        </main>
    );
}
