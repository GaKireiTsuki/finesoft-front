import type { ProductPage } from "../lib/models/product";

interface ProductDetailProps {
    page: ProductPage;
}

export default function ProductDetail({ page }: ProductDetailProps) {
    return (
        <section className="page page-product">
            <a href="/">← Back</a>
            <h1>{page.product.name}</h1>
            <p className="price price-large">${page.product.price.toFixed(2)}</p>
            <p>{page.product.description}</p>
        </section>
    );
}
