import type { ProductItem } from "../lib/models/product";

interface ProductCardProps {
    item: ProductItem;
}

export default function ProductCard({ item }: ProductCardProps) {
    return (
        <article className="product-card">
            <h3>{item.name}</h3>
            <p className="price">${item.price.toFixed(2)}</p>
            {item.clickAction && "url" in item.clickAction && (
                <a href={item.clickAction.url}>View Details &rarr;</a>
            )}
        </article>
    );
}
