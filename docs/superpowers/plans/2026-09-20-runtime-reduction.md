# Runtime reduction implementation plan

**Goal:** Reduce the current 13,870-line runtime implementation as far as verified equivalence permits, targeting more than 50% while treating stability, performance, security and existing capabilities as prerequisites.

**Baseline:** `64e6be3` includes the previous 11 verified regression repairs. The original checkout remains unchanged during implementation. Prior baseline validation: 844 tests, 17 builds, six production-template browser scenarios and 14 native browser groups. New workspace dependencies use `vp install`.

**Design:** Reuse one implementation for repeated navigation traversal, execution bookkeeping, history writes and adapter output. Keep the current public contracts and state owners. Existing cancellation, guarded transactions, stream lifetimes, storage isolation, Action/modal and native commit semantics are requirements. No new dependencies or framework layers are planned. Candidate consolidations are retained only when they actually reduce implementation without changing behavior.

**Counting:** Same six runtime `src` trees and existing measurement script; declarations, tests, docs and output excluded. Also record non-comment lexical units, file count and built JS. Removing comments, compressing formatting, moving source into templates/scripts/generated strings or offloading code to dependencies does not count as a responsibility reduction.

**Execution:** The user authorized implementation with tests after implementation. Root integrates independent module edits in this isolated worktree and runs verification once the implementation batch is complete. No repeated approval gate, remote push or deployment. A 50% result is an objective, not an assumed outcome; report the actual result if preserving the requirements prevents reaching it.

## Review focus

1. Default stack operations select the deepest active stack, whereas tab/split operations select the outer matching container; explicit targets retain their different rules.
2. Query policies precede cached results; invalidation, cancellation and scope disposal cannot be merged into a single generation flag.
3. Runtime and execution provider lifetimes remain distinct; preserve external-runtime overrides, lazy locale-specific Translator and SSR Storage isolation.
4. Browser history restoration waits for navigation and native commit, saves departing scroll and compensates rejected popstate without racing later navigation.
5. Host output paths, public-cache eligibility, response metadata and resource cleanup remain identical; no security validation is removed.

## Tasks

- [x] **Navigation algorithms:** Unified repeated active-path descent and stack editing. Nearest-stack and matching-container searches still stop at the first match; default stack selection still uses the deepest active stack. Destination assembly consolidation in `controller.ts` increased code and was reverted.
- [x] **Execution and providers:** Consolidated repeated operation completion records and promise cleanup. Shared provider builders increased indirection without reducing code and were reverted. The page-operation boundary and prefetch identity protocol remain intact.
- [x] **Deployment adapters:** Shared prerender output writing and temporary-entry cleanup. Netlify's cache remains platform-specific: replacing FIFO with the shared LRU changed eviction behavior, so that attempt was reverted. Tests now execute real build helpers and the generated Netlify cache behavior, including cleanup after a rejected build.
- [x] **Browser seams:** Shared the four history write paths while preserving state-less versus cached entries, scroll, history position and logging. Navigation bridge/view forwarding remains explicit because generic rebinding would introduce machinery and risk the receiver semantics of injected controllers.
- [x] **Implementation review:** Independent final diff review found the Netlify FIFO/LRU behavior change, now corrected. Root also corrected an early-stop regression in the shared navigation walker. Retained state owners and security checks are not duplicate responsibilities merely because their wrappers resemble each other.
- [x] **Validation:** `vp check`, full tests, 17 builds, production browser draft tests, native renderer verification and public artifact probes passed. Source/artifact and production SSR/browser performance comparisons completed against the preserved baseline. Independent review findings were corrected before delivery.
- [x] **Delivery:** Recorded actual reduction, remaining constraints and measured performance in `docs/runtime-reduction-report.md`. Verified all 10 changed paths against the baseline before applying the validated diff to the original `main` worktree; preserved previous uncommitted repairs. No remote push or deployment.

## Progress

- Baseline checkpoint created at `64e6be3`; dependency installation completed. Three independent read-only module reviews found repeated code but no evidence that deleting over 6,935 lines would preserve all capabilities. Their estimates are hypotheses; only measured final changes count.
- Implementation completed before tests as requested. Runtime source is currently 13,765 lines, down 105 lines (0.76%); non-comment lexical units decreased by 850. Source files and dependencies are unchanged. This is an actual first-batch result, not achievement of the greater-than-50% target or a proof that no further architectural reduction is possible.
- `vp check` passes without warnings; full `vp test` passes 107 files / 846 tests. The two adapter suites pass again after replacing the test Function constructor with Node's VM API. All 17 package builds, production draft/reload scenarios, native renderer verification and existing public artifact regression probes pass. Artifact/performance comparison shows slightly smaller client JS and no material regression in the sampled SSR/browser flows; see `docs/runtime-reduction-report.md` for the actual numbers and limitations.
- A scope preference question is pending. In the absence of a reply, retain all existing capabilities; elapsed time is not permission to delete features.
