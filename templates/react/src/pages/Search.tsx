import ProductCard from "../components/ProductCard";
import type { SearchPage } from "../lib/models/product";

interface SearchProps {
    page: SearchPage;
}

export default function Search({ page }: SearchProps) {
    return (
        <section className="page page-search">
            <h1>{page.title}</h1>
            <p>{page.description}</p>
            <div className="results">
                {page.results.map((item) => (
                    <ProductCard key={item.id} item={item} />
                ))}
            </div>
            {page.results.length === 0 && <p>No products found.</p>}
        </section>
    );
}
