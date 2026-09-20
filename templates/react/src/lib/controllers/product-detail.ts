import { BaseController, DEP_KEYS, type Logger, type LoggerFactory } from "@finesoft/front";
import { markPublic } from "@finesoft/front/web";
import type { ProductPage } from "../models/product";
import type {
    ProductDetailControllerFailure as Failure,
    ProductDetailControllerInput as Input,
} from "../../../.finesoft/controller-types";

export class ProductDetailController extends BaseController<Input, ProductPage> {
    async execute({ params, context }: Input): Promise<ProductPage> {
        const loggerFactory = await context.get<LoggerFactory>(DEP_KEYS.LOGGER_FACTORY);
        const log: Logger = loggerFactory.loggerFor("ProductDetailController");
        log.info(`Loading product ${params.id}`);

        // Simulated API fetch — replace with real HttpClient call
        return markPublic(
            {
                id: `product-${params.id}`,
                pageType: "product",
                title: `Product ${params.id}`,
                description: `Details for product ${params.id}`,
                url: `/products/${params.id}`,
                product: {
                    id: String(params.id),
                    name: `Product ${params.id}`,
                    price: 29.99,
                    description:
                        "This is a demo product showcasing route-inferred params and DI container usage.",
                    imageUrl: `/img/product-${params.id}.svg`,
                },
            },
            {
                product: {
                    id: true,
                    name: true,
                    price: true,
                    description: true,
                    imageUrl: true,
                },
            },
        );
    }

    fallback({ params, error }: Failure): ProductPage {
        return markPublic(
            {
                id: `product-${params.id}`,
                pageType: "product",
                title: "Product Not Found",
                description: error.message,
                url: `/products/${params.id}`,
                product: {
                    id: String(params.id),
                    name: "Unknown Product",
                    price: 0,
                    description: "Could not load product data.",
                    imageUrl: "/img/placeholder.svg",
                },
            },
            {
                product: {
                    id: true,
                    name: true,
                    price: true,
                    description: true,
                    imageUrl: true,
                },
            },
        );
    }
}
