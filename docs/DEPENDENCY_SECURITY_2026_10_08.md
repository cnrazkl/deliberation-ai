# Next.js runtime security update — 8 October 2026

The full dependency audit observed six Next.js findings in the installed 16.3.6:
one high, four moderate and one low. All list 16.3.8 as the fixed runtime version.
The owner-authorized Group 3 increment includes this required audit correction.
No finding is suppressed or reclassified by the application.

The authoritative records are
[image optimization SSRF](https://github.com/advisories/GHSA-cjq9-62q9-8jv4),
[pending cache fill](https://github.com/advisories/GHSA-3w37-wq28-93x7),
[cache finding](https://github.com/advisories/GHSA-4jqv-mc3x-m676),
[low-severity finding](https://github.com/advisories/GHSA-39w2-rjm5-chcv),
[cache finding](https://github.com/advisories/GHSA-f87g-xv8r-7p7x),
[SSG/ISR cache poisoning](https://github.com/advisories/GHSA-mcj8-r9mp-w47p)
and the [16.3.8 release](https://github.com/vercel/next.js/releases/tag/v16.3.8).
This records the dependency findings, not an observed exploit in the local app.

Only runtime `next` moves to exact 16.3.8 with its locked runtime dependencies.
`eslint-config-next`, its plugin, scoped tinyglobby alias and authenticated patch
remain at the separately reviewed 16.3.6 boundary. There is no lint rule or glob
policy change. Frozen installation, compatibility, type/lint/build, audit and
loopback runtime checks are required before publication.

Final verification results are recorded with the Group 3 increment in
[current state](CURRENT_STATE.md) and [synthesis evidence](REVIEWED_SYNTHESIS.md).
