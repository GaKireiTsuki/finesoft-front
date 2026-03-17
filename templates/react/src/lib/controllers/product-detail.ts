import {
    BaseController,
    type Container,
    DEP_KEYS,
    type Logger,
    type LoggerFactory,
} from "@finesoft/front";
import type { ProductPage } from "../models/product";

export class ProductDetailController extends BaseController<{ id: string }, ProductPage> {
    readonly intentId = "product-detail";

    async execute(params: { id: string }, container: Container): Promise<ProductPage> {
        const loggerFactory = container.resolve<LoggerFactory>(DEP_KEYS.LOGGER_FACTORY);
        const log: Logger = loggerFactory.loggerFor("ProductDetailController");
        log.info(`Loading product ${params.id}`);

        // Simulated API fetch — replace with real HttpClient call
        return {
            id: `product-${params.id}`,
            pageType: "product",
            title: `Product ${params.id}`,
            description: `Details for product ${params.id}`,
            url: `/products/${params.id}`,
            product: {
                id: params.id,
                name: `Product ${params.id}`,
                price: 29.99,
                description:
                    "This is a demo product showcasing BaseController with typed params and DI container usage.",
                imageUrl: `/img/product-${params.id}.svg`,
            },
        };
    }

    fallback(params: { id: string }, error: Error): ProductPage {
        return {
            id: `product-${params.id}`,
            pageType: "product",
            title: "Product Not Found",
            description: error.message,
            url: `/products/${params.id}`,
            product: {
                id: params.id,
                name: "Unknown Product",
                price: 0,
                description: "Could not load product data.",
                imageUrl: "/img/placeholder.svg",
            },
        };
    }
}
