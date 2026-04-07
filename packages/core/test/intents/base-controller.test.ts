import { describe, expect, test } from "vite-plus/test";
import { Container } from "../../src/dependencies/container";
import { BaseController } from "../../src/intents/base-controller";

describe("BaseController", () => {
    test("returns the result of execute on success", async () => {
        class SuccessController extends BaseController<{ id: string }, string> {
            readonly intentId = "success";

            execute(params: { id: string }): string {
                return `ok:${params.id}`;
            }
        }

        const controller = new SuccessController();

        await expect(
            controller.perform({ id: "success", params: { id: "42" } }, new Container()),
        ).resolves.toBe("ok:42");
    });

    test("passes errors through fallback and wraps non-Error values", async () => {
        class FallbackController extends BaseController<{ id?: string }, string> {
            readonly intentId = "fallback";

            execute(): string {
                throw "boom";
            }

            fallback(params: { id?: string }, error: Error): string {
                return `${params.id ?? "missing"}:${error.message}`;
            }
        }

        const controller = new FallbackController();

        await expect(
            controller.perform({ id: "fallback", params: { id: "7" } }, new Container()),
        ).resolves.toBe("7:boom");
    });

    test("rethrows execute errors when fallback is not overridden", async () => {
        class ErrorController extends BaseController<Record<string, string>, string> {
            readonly intentId = "error";

            execute(): string {
                throw new Error("failed");
            }
        }

        const controller = new ErrorController();

        await expect(controller.perform({ id: "error" }, new Container())).rejects.toThrow(
            "failed",
        );
    });
});
