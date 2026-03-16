import ProductCard from "../components/ProductCard";
import type { HomePage } from "../lib/models/product";

export default function Home({ page }: { page: HomePage }) {
    return (
        <div>
            <h1>{page.title}</h1>
            <p>{page.description}</p>
            {page.shelves.map((shelf) => (
                <section key={shelf.id}>
                    <h2>{shelf.title}</h2>
                    <div
                        style={{
                            display: "flex",
                            gap: "1rem",
                            flexWrap: shelf.isHorizontal ? "nowrap" : "wrap",
                            overflowX: shelf.isHorizontal ? "auto" : undefined,
                        }}
                    >
                        {shelf.items.map((item) => (
                            <ProductCard key={item.id} item={item} />
                        ))}
                    </div>
                </section>
            ))}
        </div>
    );
}
