import { Outlet, type WebAppView } from "@finesoft/front/react";
import type { BasePage } from "@finesoft/front/web";
import { views } from "./views";

interface AppProps {
    readonly app: WebAppView;
}

export default function App({ app }: AppProps) {
    return <Outlet app={app} views={views} />;
}

export function Page({ page }: { readonly page: BasePage }) {
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
