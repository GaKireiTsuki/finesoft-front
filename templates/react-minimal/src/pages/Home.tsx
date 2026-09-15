import type { BrowserAppHandle } from "@finesoft/front/browser";
import type { Framework } from "@finesoft/front/web";
import type { HomePage } from "../lib/models/page";
import { getHomeLocale } from "../lib/locale";

export default function Home({
    page,
    controller,
    framework,
}: {
    page: HomePage;
    controller?: BrowserAppHandle;
    framework?: Framework;
}) {
    const locale = getHomeLocale(framework);
    return (
        <section className="page">
            <h1>{page.title}</h1>
            <p>{page.description}</p>
            <ul className="feed">
                {page.items.map((item) => (
                    <li key={item.id}>
                        <button
                            onClick={() =>
                                void controller?.navigation?.push("detail", { id: item.id })
                            }
                        >
                            {item.title}
                        </button>
                    </li>
                ))}
            </ul>
            <section className="locale-info" aria-label="Locale">
                <p>
                    <strong>{locale.label}:</strong> {locale.lang}
                </p>
                <p>{locale.badge}</p>
                <p>{locale.hint}</p>
            </section>
        </section>
    );
}
