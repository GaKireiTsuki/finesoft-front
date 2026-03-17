import type { Action } from "@finesoft/front";
import type { AboutPage } from "../lib/models/product";

interface AboutProps {
    page: AboutPage;
    onAction?: (action: Action) => void;
}

export default function About({ page }: AboutProps) {
    return (
        <div>
            <h1>{page.title}</h1>
            <p>{page.content}</p>
        </div>
    );
}
