import type { Action } from "@finesoft/front";
import { makeFlowAction } from "@finesoft/front";
import type { ProductPage } from "../lib/models/product";

interface ProductDetailProps {
    page: ProductPage;
    onAction?: (action: Action) => void;
}

export default function ProductDetail({ page, onAction }: ProductDetailProps) {
    const handleBack = (e: React.MouseEvent) => {
        e.preventDefault();
        onAction?.(makeFlowAction("/"));
    };

    return (
        <div>
            <a href="/" onClick={handleBack}>
                ← Back
            </a>
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
