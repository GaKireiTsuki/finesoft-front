import type { Action } from "@finesoft/front/web";
import { NAV_ACTIONS } from "../actions";
import type { ProductPage } from "../lib/models/product";

interface ProductDetailProps {
    page: ProductPage;
    onAction?: (action: Action) => void;
}

export default function ProductDetail({ page, onAction }: ProductDetailProps) {
    const handleBack = (event: React.MouseEvent<HTMLAnchorElement>) => {
        if (
            !onAction ||
            event.defaultPrevented ||
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
        )
            return;
        event.preventDefault();
        onAction(NAV_ACTIONS.home);
    };

    return (
        <section className="page page-product">
            <a href="/" onClick={handleBack}>
                ← Back
            </a>
            <h1>{page.product.name}</h1>
            <p className="price price-large">${page.product.price.toFixed(2)}</p>
            <p>{page.product.description}</p>
        </section>
    );
}
