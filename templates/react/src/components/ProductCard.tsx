import type { Action } from "@finesoft/front/web";
import type { ProductItem } from "../lib/models/product";

interface ProductCardProps {
    item: ProductItem;
    onAction?: (action: Action) => void;
}

export default function ProductCard({ item, onAction }: ProductCardProps) {
    const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
        if (
            !onAction ||
            !item.clickAction ||
            event.defaultPrevented ||
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
        ) {
            return;
        }
        event.preventDefault();
        onAction(item.clickAction);
    };

    return (
        <article className="product-card">
            <h3>{item.name}</h3>
            <p className="price">${item.price.toFixed(2)}</p>
            {item.clickAction && "url" in item.clickAction && (
                <a href={item.clickAction.url} onClick={handleClick}>
                    View Details &rarr;
                </a>
            )}
        </article>
    );
}
