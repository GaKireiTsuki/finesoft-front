import type { Action } from "@finesoft/front";
import { makeFlowAction } from "@finesoft/front";
import type { ErrorPage } from "../lib/models/product";

interface NotFoundProps {
    page: ErrorPage;
    onAction?: (action: Action) => void;
}

export default function NotFound({ page, onAction }: NotFoundProps) {
    const handleHome = (e: React.MouseEvent) => {
        e.preventDefault();
        onAction?.(makeFlowAction("/"));
    };

    return (
        <div>
            <h1>{page.title}</h1>
            <p>{page.description}</p>
            <a href="/" onClick={handleHome}>
                ← Go Home
            </a>
        </div>
    );
}
