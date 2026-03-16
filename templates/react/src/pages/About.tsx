import type { AboutPage } from "../lib/models/product";

export default function About({ page }: { page: AboutPage }) {
    return (
        <div>
            <h1>{page.title}</h1>
            <p>{page.content}</p>
        </div>
    );
}
