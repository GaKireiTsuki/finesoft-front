import type { BasePage } from "@finesoft/front";

/** Notes：第二个 tab，纯展示（切 tab 保活由 islands 负责）。 */
export default function NotesView({ page }: { page: BasePage }) {
    return (
        <section>
            <h1 style={{ margin: "0 0 0.25rem" }}>{page.title}</h1>
            <p style={{ color: "#666", margin: "0 0 1rem" }}>{page.description}</p>
        </section>
    );
}
