import { BaseController, type BasePage, type Container, markPublic } from "@finesoft/front";
import { timingSafeEqual } from "node:crypto";
import { TRACED_USER } from "../middleware/trace-user";

interface AdminSecretsPage extends BasePage {
    adminToken?: string;
}

/**
 * Constant-time string compare. Returns false for any length mismatch
 * or empty inputs, so an unset ADMIN_TOKEN can never match a cookie
 * that happens to be the string "admin".
 */
function safeEqual(a: string, b: string): boolean {
    if (!a || !b || a.length !== b.length) return false;
    const aBuf = Buffer.from(a, "utf8");
    const bBuf = Buffer.from(b, "utf8");
    return timingSafeEqual(aBuf, bBuf);
}

export class AdminSecretsController extends BaseController<
    Record<string, string>,
    AdminSecretsPage
> {
    readonly intentId = "admin-secrets";

    execute(_params: Record<string, string>, container: Container): AdminSecretsPage {
        const user = TRACED_USER.get(container) ?? null;

        // The cookie carries an opaque admin token, NOT the username. Compare
        // constant-time against a server-only secret. Unset env var = no admin.
        const expected = process.env["ADMIN_TOKEN"] ?? "";
        const presented = user?.name ?? "";
        const authorized = safeEqual(presented, expected);

        if (authorized) {
            return markPublic<AdminSecretsPage>(
                {
                    id: "admin-secrets",
                    pageType: "admin",
                    title: "Admin secrets",
                    description: `Welcome admin (last seen ${new Date(user!.seenAt).toISOString()})`,
                    adminToken: "FLAG{di-3e8b4c1a}",
                },
                ["id", "pageType", "title", "description", "adminToken"],
            );
        }
        return markPublic<AdminSecretsPage>(
            {
                id: "admin-secrets",
                pageType: "admin",
                title: "Admin secrets",
                description: "Forbidden.",
            },
            ["id", "pageType", "title", "description"],
        );
    }
}
