import { makeFlowAction, mapEach, type Mapper } from "@finesoft/front";
import type { ProductItem } from "../models/product";

/** Raw API response shape */
interface ApiProduct {
    id: number;
    title: string;
    price: number;
    thumbnail?: string;
}

/** Transform raw API product → domain ProductItem */
const toProductItem: Mapper<ApiProduct, ProductItem> = (raw) => ({
    id: String(raw.id),
    itemType: "product",
    name: raw.title,
    price: raw.price,
    imageUrl: raw.thumbnail ?? "/img/placeholder.svg",
    clickAction: makeFlowAction(`/products/${raw.id}`),
});

/**
 * Composed mapper pipeline: ApiProduct[] → ProductItem[]
 *
 * Demonstrates pipe() + mapEach() for data transformation.
 */
export const mapProducts: Mapper<ApiProduct[], ProductItem[]> = mapEach(toProductItem);
