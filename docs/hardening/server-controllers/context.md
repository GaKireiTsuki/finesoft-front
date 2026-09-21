# Server controller hardening context

Analysis date: 2026-09-21. Local source root: `/Users/megumi/Desktop/projects/finesoft-front`.
Source revision: `c2fde1a9eeb7ca76e1e868c1831762e61dea3cbf`. The working tree already contained compatibility cleanup before this feature; the analysis includes the subsequent server-controller work. This is source-backed design work, not an exhaustive security scan or a published vulnerability finding.

The user selected separate shared/server Controller bases, capability-appropriate contexts, class-based isolation rather than directory conventions, and explicit request/response tools. That request authorizes implementation of the selected design. Existing actions, navigation, markPublic, DI lifetimes and compact generated type references must remain available.

The evidence inventory in hardening.json hashes the inspected source snapshot; later formatting or fixes may change it. Final checks and browser evidence are recorded in verification.md and the repeatable scripts, independently of these design claims. Synthetic markers only; no production secrets or accounts were used.

The user clarified that login state belongs to application code. Automatic server-side credential forwarding, automatic internal-response cookie copying and request-cookie mutation were removed; the framework exposes transport and response-writing tools only.
