# Synthetic browser capability canary

No Sage application, auth, customer fixture or production endpoint is loaded.
The only page is independently authored fictional HTML. This is not release proof.

Runtime: ubuntu-22.04 GitHub VM; official Playwright v1.63.0 Noble linux/amd64 image digest
bc6ab0d6d44ff4826e4cb8c1e6d801e185bfc42bb0753f8e2a30efc70db054c7.
Registry index eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27.
The image defaults to Node24. This canary supplies official Node22.23.4 via HTTPS and
pinned SHA2561805bcd35e6815559bd2eb97db438d3fdb0eb3a5e6a977b7c1badca76337e9ce,
compared with the official version manifest before extraction/execution.

seccomp.json is unmodified https://raw.githubusercontent.com/microsoft/playwright/v1.63.0/utils/docker/seccomp_profile.json,
SHA256cc3e61cabda6bbc1e53e54d27ba4d55a9d3be829b6dd1a596f4a7b31b1cc7849.
It is the official deny-by-default profile with namespace clone/setns/unshare support.
Default AppArmor is retained and must report enforcing. No host security settings are changed.

Provisioning fetches the image/runtime/locked npm package. Execution has no external
interface: network none, no host namespaces/socket/home/credential mounts, nonroot,
all capabilities dropped, read-only image/input/runtime, ephemeral tmp and synthetic
output only. Browser routing is additional evidence, not the OS isolation boundary.

Passing requires actual Chromium command-line inspection, namespace/PID/network and
Seccomp-BPF Yes verdicts from chrome://sandbox, a visible click transition, screenshot,
positive loopback and negative Node/browser external connectivity. Outer Seccomp2
alone is never sufficient. Missing/ambiguous evidence fails closed. A sandbox failure
is an environment result, not an application defect. No weaker fallback is permitted.

This tooling needs no historical application fingerprint refresh. The existing
security-CI envelope receives a separately reviewed successor receipt; prior receipt
and source remain recoverable in parent8cfe0ade268083bd0c9090ffd182a23f907ac4c0.
