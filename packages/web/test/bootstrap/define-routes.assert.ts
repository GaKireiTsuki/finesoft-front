import { route } from "../../src/bootstrap/define-routes";
import { int, oneOf, optional, str, type InferParams, type InferQuery } from "@finesoft/core";
const product = route("/product/:id", {
    intentId: "product",
    params: { id: int() },
    query: { sort: optional(oneOf(["asc", "desc"] as const)) },
});
// @ts-expect-error slug does not occur in the path
route("/product/:id", { intentId: "product", params: { slug: str() } });
// @ts-expect-error controller implementation belongs in the Web definition
route("/", { intentId: "home", controller: {} });
type ProductParams = InferParams<NonNullable<typeof product.params>> &
    InferQuery<NonNullable<typeof product.query>>;
const valid: ProductParams = { id: 1, sort: "asc" };
const omittedQuery: ProductParams = { id: 1 };
// @ts-expect-error decoded id is a number
const wrongId: ProductParams = { id: "1" };
// @ts-expect-error id is required
const absentId: ProductParams = { sort: "desc" };
// @ts-expect-error invalid decoded query value
const wrongSort: ProductParams = { id: 1, sort: "other" };
void [valid, omittedQuery, wrongId, absentId, wrongSort];
