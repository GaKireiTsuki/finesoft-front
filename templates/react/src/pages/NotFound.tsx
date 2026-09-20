import type { ErrorPage } from "../lib/models/product";

interface NotFoundProps {
    page: ErrorPage;
}

export default function NotFound({ page }: NotFoundProps) {
    return (
        <section className="page page-error">
            <h1>{page.title}</h1>
            <p>{page.description}</p>
            <a href="/">← Go Home</a>
        </section>
    );
}
