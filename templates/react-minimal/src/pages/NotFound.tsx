import type { ErrorPage } from "../lib/models/page";

export default function NotFound({ page }: { page: ErrorPage }) {
    return (
        <section className="page">
            <h1>{page.title}</h1>
            <p>{page.description}</p>
            <a href="/">← Go Home</a>
        </section>
    );
}
