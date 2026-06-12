import {
    isStackNode,
    isTabsNode,
    type AppHandle,
    type NavigationHandle,
    type NavigationSnapshot,
} from "@finesoft/front";
import { useEffect, useState } from "react";

/** name 全局切片的极小外部 store 接口（main 创建并注入；App 只读它 + 订阅）。 */
export interface NameStore {
    get(): string;
    set(value: string): void;
    subscribe(listener: () => void): () => void;
}

export interface AppProps {
    /** 首屏快照：SSR 与客户端 hydrate 时一致（URL 推导，tree 相同）→ 无水合失配。 */
    initialSnapshot: NavigationSnapshot | null;
    /** 导航 handle（客户端有；SSR 无）。提供后订阅 snapshot 变更驱动重渲。 */
    nav?: NavigationHandle;
    /** 框架统一句柄（selectTab / pop / save）。SSR 无（渲染不依赖，仅事件处理用）。 */
    controller?: AppHandle;
    /** name 切片 store（客户端注入；SSR 无 → name 恒 ""）。 */
    nameStore?: NameStore;
}

const TAB_LABELS: Record<string, string> = { home: "Feed", notes: "Notes" };

export default function App({ initialSnapshot, nav, controller, nameStore }: AppProps) {
    // 首渲用 initialSnapshot（= SSR 快照，tree 一致）→ 水合 DOM 一致；effect 仅客户端跑，订阅后续提交。
    const [snapshot, setSnapshot] = useState(initialSnapshot);
    useEffect(() => {
        if (!nav) return;
        setSnapshot(nav.getSnapshot()); // 追平 render→effect 间隙可能的提交
        return nav.subscribe(setSnapshot);
    }, [nav]);

    // name 恒 "" 首渲（SSR + 水合一致）；会话恢复在水合后经 store 落，订阅驱动重渲。
    const [name, setName] = useState("");
    useEffect(() => {
        if (!nameStore) return;
        setName(nameStore.get());
        return nameStore.subscribe(() => setName(nameStore.get()));
    }, [nameStore]);

    const tree = snapshot?.tree ?? null;
    const tabBar = tree && isTabsNode(tree) ? { order: tree.order, active: tree.active } : null;
    const branch = tree && isTabsNode(tree) ? tree.branches[tree.active] : null;
    const canGoBack = !!branch && isStackNode(branch) && branch.entries.length > 1;

    return (
        <div
            style={{
                maxWidth: "32rem",
                margin: "0 auto",
                padding: "1rem",
                fontFamily: "system-ui",
            }}
        >
            {/* 全局切片：名字 */}
            <header
                style={{
                    display: "flex",
                    gap: "0.5rem",
                    alignItems: "center",
                    marginBottom: "1rem",
                }}
            >
                <label style={{ flex: 1 }}>
                    Your name (global):
                    <input
                        value={name}
                        placeholder="anon"
                        onChange={(e) => {
                            setName(e.target.value);
                            nameStore?.set(e.target.value);
                        }}
                        onBlur={() => void controller?.save()}
                    />
                </label>
                {name && <span>👋 {name}</span>}
            </header>

            {/* TabView */}
            {tabBar && (
                <nav style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
                    {tabBar.order.map((key) => (
                        <button
                            key={key}
                            style={{ fontWeight: key === tabBar.active ? 700 : 400 }}
                            aria-current={key === tabBar.active}
                            onClick={() => void controller?.selectTab(key)}
                        >
                            {TAB_LABELS[key] ?? key}
                        </button>
                    ))}
                </nav>
            )}

            {canGoBack && (
                <button style={{ marginBottom: "0.5rem" }} onClick={() => void controller?.pop()}>
                    ← Back
                </button>
            )}
        </div>
    );
}
