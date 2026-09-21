# Server controller execution boundary

## Evidence Basis

I inspected the execution, navigation, SSR assembly, Vite transformation and internal-fetch owners. A shared controller implementation participates in the browser import graph, so public data projection cannot provide code isolation. Incoming requests and outgoing responses have separate header collections. The user clarified that application code must decide how to connect them; the framework supplies request access and response-writing tools, without owning login state. This analysis is based on source and focused probes, not an exhaustive repository scan.

## Constraints

We retain independent controller classes, the object input signature, route-derived types and the existing DI/navigation lifecycle. We reuse the SSR page loader and public projection rather than introducing another runtime. Server code must stay out of client modules and source maps without relying on directory names. Browser navigation needs a request host.

## Opportunity Portfolio

| Opportunity                        | Baseline                                                        | Selected design                                                 | Evidence                                                                              |
| ---------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Server execution and request tools | Explicit endpoints with manual source separation and forwarding | BaseServerController, compiler references and one request state | [Proposal](proposals/server-controllers.md), [plan](implementation/class-boundary.md) |

The baseline remains appropriate for independent login/registration commands. For page controllers, I recommend the class boundary selected by the user: we can preserve the familiar route definition while enforcing a single execution and projection path. It adds a transport request during client navigation, so it cannot make remote execution equivalent in latency to in-browser work.

## Recommendation Summary

We implement one structural boundary, with tactical protections at its edges: server-only dependency rejection, same-origin requests, bounded request bodies, route validation, server-side guards, public projection and per-request cookie state. See [verification](verification.md) for observations; the design itself is not evidence that every protection works.

## Next Decisions

No product choice is awaiting approval. Applications still decide authentication policy, refresh rotation and which result fields are public. Static-only deployments must keep shared controllers or adopt a request host.
