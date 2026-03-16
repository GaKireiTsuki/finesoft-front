import type { BasePage } from "@finesoft/front";

export default function NotFound({ page }: { page: BasePage }) {
    return (
        <div>
            <h1>{page.title}</h1>
            <p>{page.description}</p>
            <a href="/">← Go Home</a>
        </div>
    );
}
