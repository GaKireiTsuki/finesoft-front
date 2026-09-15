import type { Action } from "@finesoft/front/web";
import { NAV_ACTIONS } from "../actions";
import type { ErrorPage } from "../lib/models/product";

interface NotFoundProps {
    page: ErrorPage;
    onAction?: (action: Action) => void;
}

export default function NotFound({ page, onAction }: NotFoundProps) {
    const handleHome = (event: React.MouseEvent<HTMLAnchorElement>) => {
        if (
            !onAction ||
            event.defaultPrevented ||
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
        )
            return;
        event.preventDefault();
        onAction(NAV_ACTIONS.home);
    };

    return (
        <section className="page page-error">
            <h1>{page.title}</h1>
            <p>{page.description}</p>
            <a href="/" onClick={handleHome}>
                ← Go Home
            </a>
        </section>
    );
}
