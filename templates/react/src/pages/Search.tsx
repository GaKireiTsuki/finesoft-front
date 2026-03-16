import ProductCard from "../components/ProductCard";
import type { SearchPage } from "../lib/models/product";

export default function Search({ page }: { page: SearchPage }) {
    return (
        <div>
            <h1>{page.title}</h1>
            <p>{page.description}</p>
            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                {page.results.map((item) => (
                    <ProductCard key={item.id} item={item} />
                ))}
            </div>
            {page.results.length === 0 && <p>No products found.</p>}
        </div>
    );
}
