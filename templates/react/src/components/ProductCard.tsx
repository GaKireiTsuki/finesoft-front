import type { Action } from "@finesoft/front";
import type { ProductItem } from "../lib/models/product";

interface ProductCardProps {
    item: ProductItem;
    onAction?: (action: Action) => void;
}

export default function ProductCard({ item, onAction }: ProductCardProps) {
    const handleClick = item.clickAction
        ? (e: React.MouseEvent) => {
              e.preventDefault();
              onAction?.(item.clickAction!);
          }
        : undefined;

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
                <a href={item.clickAction.url} onClick={handleClick}>
                    View Details &rarr;
                </a>
            )}
        </div>
    );
}
