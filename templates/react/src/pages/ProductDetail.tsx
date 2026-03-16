import type { ProductPage } from "../lib/models/product";

export default function ProductDetail({ page }: { page: ProductPage }) {
    return (
        <div>
            <a href="/">← Back</a>
            <h1>{page.product.name}</h1>
            <p
                style={{
                    fontSize: "1.5rem",
                    color: "#007bff",
                    fontWeight: "bold",
                }}
            >
                ${page.product.price.toFixed(2)}
            </p>
            <p>{page.product.description}</p>
        </div>
    );
}
