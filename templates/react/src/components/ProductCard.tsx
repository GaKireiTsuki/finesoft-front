import type { ProductItem } from "../lib/models/product";

export default function ProductCard({ item }: { item: ProductItem }) {
    return (
        <div
            style={{
                border: "1px solid #eee",
                borderRadius: "8px",
                padding: "1rem",
                minWidth: "200px",
            }}
        >
            <h3>{item.name}</h3>
            <p style={{ color: "#007bff", fontWeight: "bold" }}>${item.price.toFixed(2)}</p>
            {item.clickAction && "url" in item.clickAction && (
                <a href={item.clickAction.url}>View Details &rarr;</a>
            )}
        </div>
    );
}
