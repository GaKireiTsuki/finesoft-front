import type { BasePage } from "@finesoft/front";

/**
 * Detail：由 push("detail", { id }) 进入。
 *
 * 零样板保活：标一个 data-restore-root，里面的裸 <input>（非受控）即自动：
 * - in-session：push 走、pop 回来值还在（islands 保活，实例没销毁）
 * - 重载：sessionStorage 回填（domRestore），合成事件驱动可能的受控绑定
 * 注意必须用**非受控** input（无 value/onChange）——否则 React 会盖掉 domRestore 的命令式写值。
 */
export default function DetailView({ page }: { page: BasePage }) {
    return (
        <section>
            <h1 style={{ margin: "0 0 0.25rem" }}>{page.title}</h1>
            <p style={{ color: "#666", margin: "0 0 1rem" }}>{page.description}</p>
            <div data-restore-root>
                <label style={{ display: "block", marginTop: "1rem" }}>
                    Draft note for this screen:
                    <input
                        name="note"
                        placeholder="kept while alive; restored on reload"
                        style={{ width: "100%" }}
                    />
                </label>
            </div>
        </section>
    );
}
