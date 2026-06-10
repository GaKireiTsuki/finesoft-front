import { BaseController, type BasePage, markPublic } from "@finesoft/front";

interface ProfileParams extends Record<string, string | undefined> {
    userId?: string;
}

interface ProfilePage extends BasePage {
    email?: string;
    avatarUrl?: string;
    apiToken?: string;
    internalNotes?: string;
}

const USER_DB: Record<string, ProfilePage> = {
    alice: {
        id: "profile",
        pageType: "profile",
        title: "Alice",
        description: "Hi, I'm Alice.",
        email: "alice@example.com",
        avatarUrl: "/static/alice.png",
        apiToken: "atk_alice_e7q9",
        internalNotes: "regular user; signed up 2025-01-12",
    },
    bob: {
        id: "profile",
        pageType: "profile",
        title: "Bob",
        description: "Bob's profile.",
        email: "bob@example.com",
        avatarUrl: "/static/bob.png",
        apiToken: "atk_bob_h2p1",
        internalNotes: "regular user; on the support team",
    },
    admin: {
        id: "profile",
        pageType: "profile",
        title: "Admin",
        description: "Administrator account.",
        email: "admin@example.com",
        avatarUrl: "/static/admin.png",
        apiToken: "FLAG{prefetch-c2a9d8f1}",
        internalNotes: "do not share - rotates monthly",
    },
};

const PUBLIC_FIELDS = [
    "id",
    "pageType",
    "title",
    "description",
    "email",
    "avatarUrl",
] as const satisfies readonly (keyof ProfilePage)[];

export class ProfileController extends BaseController<ProfileParams, ProfilePage> {
    readonly intentId = "profile";

    execute(params: ProfileParams): ProfilePage {
        const userId = (params.userId ?? "").toLowerCase();
        const user = USER_DB[userId];
        if (!user) {
            return markPublic<ProfilePage>(
                {
                    id: "profile",
                    pageType: "profile",
                    title: "Unknown user",
                    description: `No user named "${params.userId ?? ""}".`,
                },
                PUBLIC_FIELDS,
            );
        }
        // Return the whole user record, but markPublic tells serializeServerData
        // which fields are safe to expose in the SSR HTML. apiToken /
        // internalNotes stay server-side; the framework strips them at the
        // serialization boundary even though they're on the object here.
        return markPublic<ProfilePage>(user, PUBLIC_FIELDS);
    }
}
