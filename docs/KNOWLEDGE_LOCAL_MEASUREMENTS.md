# DA-126 local measurement procedure

This engineering diagnostic executes the frozen DA-119 questions against actual
encrypted local source preparation. It is not a quality acceptance decision.
Run from the provisioned local checkout:

    pnpm knowledge:benchmark

The runner validates the provisioned loopback database configuration, creates a
random disposable database, migrates it, runs the measurement and drops it in
finally. The benchmark itself refuses a non-disposable database before any write.
It does not replace root environment files, upload sources, call providers or
alter the owner's data. Normal integration verification includes the mechanical
test; only the explicit benchmark command writes a uniquely named, non-overwriting
report under ignored .local/knowledge-evaluation/measurements/.

The unchanged plan, source-suite, protocol, fixture and approval hashes are verified
first. The 11 retained external snapshots compile into ten unique source bundles;
these bundles, including source-reference headers, are imported as immutable TXT
sources into one explicitly granted collection. Every question sees the same
selected bundle inventory. This is a small retained-snapshot workload, not current
remote documents, a full private library, original-format extraction or the maximum
trial workload.

Each of the 40 frozen questions is used unchanged as the literal lexical query in
two phases: new PostgreSQL connection pool and reused pool. Both use fresh
preparation identities; neither measures receipt replay. New-pool time includes
connection initialization but excludes pool shutdown. OS/PostgreSQL caches are not
flushed, so these phases do not satisfy the protocol's genuine cold-cache experiment.
Successful and failed attempts remain in the nearest-rank p95 denominator, with
failure classes and unknown excerpt counts retained. Any failure prevents a
positive latency-target observation, even when refusal is fast.

Source-derived first-token positive controls additionally check that each bundle
can return its own exact source/version citation. Original bytes/hash, excerpt
bytes/hash, extraction digest and containing page span are checked by reading back
the stored version. These controls supply mechanical evidence, not independent
retrieval recall or citation entailment.

Reports retain the plan hash, source/version/parser/hash inventory, implementation
file digests, query policy, sample timings, packet fingerprints, counts and runtime
platform/architecture/Node version. They omit questions, source text, credentials,
local database addresses and machine/user names. Reruns create new observations;
they never overwrite an earlier run or change the held-out cohort.

Character counts are UTF-16 code units for the complete selected snapshot bundles
and delivered excerpt text. They exclude prompt/citation overhead and are not model
tokens, context eligibility, provider usage or savings. Sampled process RSS is
recorded before and after attempts; the true peak and PostgreSQL memory are unknown.
Independent gold, format coverage, model answer coverage, critical recall, entailment,
setup/monthly duties, invoice cost and clustered paired uncertainty remain unassessed.
Release acceptance stays blocked even when all mechanics pass.

The literal-question diagnostic does not rewrite queries after observing results.
The current lexical policy accepts at most 12 distinct tokens and requires all
tokens to occur in a source. A natural-language question therefore may be refused
or return no evidence. The existing UI's separate, owner-selected keyword query
and manual quote workflow remain available; their human/model quality still requires
a separately frozen comparison. Do not silently tune retrieval on this held-out
diagnostic or call an empty packet adequate evidence.

[Observed results and open gates](DA126_ACCEPTANCE.md).
