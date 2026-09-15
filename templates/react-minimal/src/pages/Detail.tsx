import type { DetailPage } from "../lib/models/page";

export default function Detail({ page }: { page: DetailPage }) {
    return (
        <section className="page">
            <h1>{page.title}</h1>
            <p>{page.description}</p>
            {/* The entry owns this draft; data-restore-root also restores it after reload. */}
            <div className="draft" data-restore-root>
                <label>
                    Detail note
                    <input
                        name="note"
                        placeholder="Kept while this screen is alive; lost when popped"
                    />
                </label>
            </div>
        </section>
    );
}
