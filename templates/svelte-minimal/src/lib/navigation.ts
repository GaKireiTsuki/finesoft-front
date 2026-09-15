import { isStackNode, isTabsNode, type NavigationSnapshot } from "@finesoft/front/web";

export const TAB_LABELS: Readonly<Record<string, string>> = { home: "Feed", notes: "Notes" };

/** The renderer supplies each committed snapshot; chrome needs no second subscription. */
export function getNavigationChrome(snapshot?: NavigationSnapshot) {
    const tree = snapshot?.tree;
    const tabs = tree && isTabsNode(tree) ? { order: tree.order, active: tree.active } : null;
    const branch = tree && isTabsNode(tree) ? tree.branches[tree.active] : null;
    return { tabs, canGoBack: !!branch && isStackNode(branch) && branch.entries.length > 1 };
}
