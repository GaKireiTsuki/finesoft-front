import type { NotesPage } from "../lib/models/page";

export default function Notes({ page }: { page: NotesPage }) {
    return (
        <section className="page">
            <h1>{page.title}</h1>
            <p>{page.description}</p>
            {/* The entry owns this draft; data-restore-root also restores it after reload. */}
            <div className="draft" data-restore-root>
                <label>
                    Notes draft
                    <textarea
                        name="notes"
                        rows={6}
                        placeholder="Write a note; switch tabs or reload to restore it"
                    />
                </label>
            </div>
        </section>
    );
}
