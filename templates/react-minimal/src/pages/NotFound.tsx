import type { BrowserAppHandle } from "@finesoft/front/browser";
import { createNavigation } from "../app-definition";
import type { ErrorPage } from "../lib/models/page";

export default function NotFound({
    page,
    controller,
}: {
    page: ErrorPage;
    controller?: BrowserAppHandle;
}) {
    return (
        <section className="page">
            <h1>{page.title}</h1>
            <p>{page.description}</p>
            <a
                href="/"
                onClick={(event) => {
                    if (
                        !controller?.navigation ||
                        event.button !== 0 ||
                        event.metaKey ||
                        event.ctrlKey ||
                        event.shiftKey ||
                        event.altKey
                    )
                        return;
                    event.preventDefault();
                    void controller.navigation.hydrate(createNavigation("/")!);
                }}
            >
                ← Go Home
            </a>
        </section>
    );
}
