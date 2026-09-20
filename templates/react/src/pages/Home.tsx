import ProductCard from "../components/ProductCard";
import type { HomePage } from "../lib/models/product";

interface HomeProps {
    page: HomePage;
}

export default function Home({ page }: HomeProps) {
    return (
        <section className="page page-home">
            <h1>{page.title}</h1>
            <p>{page.description}</p>
            {page.shelves.map((shelf) => (
                <section className="shelf-section" key={shelf.id}>
                    <h2>{shelf.title}</h2>
                    <div className={`shelf${shelf.isHorizontal ? " horizontal" : ""}`}>
                        {shelf.items.map((item) => (
                            <ProductCard key={item.id} item={item} />
                        ))}
                    </div>
                </section>
            ))}
        </section>
    );
}
