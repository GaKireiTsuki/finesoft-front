import type { Action } from "@finesoft/front/web";
import ProductCard from "../components/ProductCard";
import type { SearchPage } from "../lib/models/product";

interface SearchProps {
    page: SearchPage;
    onAction?: (action: Action) => void;
}

export default function Search({ page, onAction }: SearchProps) {
    return (
        <section className="page page-search">
            <h1>{page.title}</h1>
            <p>{page.description}</p>
            <div className="results">
                {page.results.map((item) => (
                    <ProductCard key={item.id} item={item} onAction={onAction} />
                ))}
            </div>
            {page.results.length === 0 && <p>No products found.</p>}
        </section>
    );
}
