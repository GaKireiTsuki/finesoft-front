import type { ViewProps } from "@finesoft/front/react";
import type { ErrorPage } from "../lib/models/page";

export default function NotFound({
    page,
    app,
}: {
    page: ErrorPage;
} & Pick<ViewProps, "app">) {
    return (
        <section className="page">
            <h1>{page.title}</h1>
            <p>{page.description}</p>
            <a
                href="/"
                onClick={(event) => {
                    if (
                        event.button !== 0 ||
                        event.metaKey ||
                        event.ctrlKey ||
                        event.shiftKey ||
                        event.altKey
                    )
                        return;
                    event.preventDefault();
                    void app.navigation.navigate("/");
                }}
            >
                ← Go Home
            </a>
        </section>
    );
}
