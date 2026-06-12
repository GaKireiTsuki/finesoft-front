import type { AppHandle, BasePage } from "@finesoft/front";
import type { FeedPage } from "../lib/controllers/home";

/** Home（feed）：列表项点击 push 进 detail。 */
export default function HomeView({ page, controller }: { page: BasePage; controller?: AppHandle }) {
    const feed = page.pageType === "home" ? (page as FeedPage) : null;
    return (
        <section>
            <h1 style={{ margin: "0 0 0.25rem" }}>{page.title}</h1>
            <p style={{ color: "#666", margin: "0 0 1rem" }}>{page.description}</p>
            {feed && (
                <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: "0.5rem" }}>
                    {feed.items.map((item) => (
                        <li key={item.id}>
                            <button
                                style={{ width: "100%", textAlign: "left" }}
                                onClick={() => void controller?.push("detail", { id: item.id })}
                            >
                                {item.title} →
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
