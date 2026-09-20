import type { AboutPage } from "../lib/models/product";

interface AboutProps {
    page: AboutPage;
}

export default function About({ page }: AboutProps) {
    return (
        <section className="page page-about">
            <h1>{page.title}</h1>
            <p>{page.content}</p>
        </section>
    );
}
