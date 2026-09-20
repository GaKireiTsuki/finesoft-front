import type { ViewProps } from "@finesoft/front/react";
import type { HomePage } from "../lib/models/page";
import { getHomeLocale } from "../lib/locale";

export default function Home({
    page,
    app,
}: {
    page: HomePage;
} & Pick<ViewProps, "app">) {
    const locale = getHomeLocale(app);
    return (
        <section className="page">
            <h1>{page.title}</h1>
            <p>{page.description}</p>
            <ul className="feed">
                {page.items.map((item) => (
                    <li key={item.id}>
                        <button
                            onClick={() =>
                                void app.perform({ kind: "flow", url: `/item/${item.id}` })
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
