# Reviewed local knowledge packets (DA-122)

The owner selects files into a local collection, explicitly opens its read grant,
binds one to three collections to a conversation and prepares a packet from a
separate search query. No collection is searched by default. A new source conversation
is empty until its first actual run; its reserved anchor then becomes that run.
The panel also lets the owner select the currently open report's conversation.

## Retrieval, budgets and review

DA-121's bounded lexical AND search scans every active source in the selected scope:
30 sources, 1,000,000 UTF-8 text bytes and five seconds in aggregate. Above these
limits preparation refuses rather than truncates the source inventory. It takes the
first page-local window per matching source, up to 1,500 UTF-16 characters. This
does not claim complete passage recall or relevance. The panel shows the exact query,
topic, selected passages, source/version/page/span, unavailable counts and exclusions.

`lexical-fair-coverage-v1` visits collections in explicit selection order and their
sources in stable UUID order, round-robin. At most six complete windows/9,000
characters enter the packet. Matching sources outside that budget retain named
versioned omission records. Identical original/text/window hashes are deduplicated;
copies remain visible and are not independent corroboration. An empty search refuses
unless the owner has explicitly allowed an evidence-free packet, which still needs
review. Neither extraction nor review promotes a passage to verified evidence.

The owner checks the passages, omissions and sharing with **every round-0 member**.
The existing exact prompt/risk preview binds the reviewed packet fingerprint. The
local `o200k_base` text estimate refuses packet runs above 24,000 input tokens per
member; the browser additionally estimates images. These are planning limits, not
provider tokenizers, universal context-window guarantees or billable usage. Unknown
model limits and quality remain unknown; DA-126 must assess actual provider windows,
output reservations, entailment, critical omissions and measured usage.

## Routing and freshness

Large/reusable TXT/Markdown/PDF/PNG/JPEG inputs use the local library. Ordinary PDF
attachments retain their existing 1 MiB cap; collection PDF intake supports 5 MiB.
With a packet, any original file already in its selected inventory is refused as a
parallel full attachment, even when its passage was excluded. New ad hoc attachments
keep their separate member sharing opt-in. No directory/ZIP traversal, OCR, arbitrary
URL/tool command, external notebook or adapter is enabled. Images and missing-text
PDF pages remain visibly unusable for quotations.

Preparation is local and atomic: no remote query/job or autonomous retrieval occurs.
An explicit preparation UUID/request hash gives immutable acknowledgement replay.
There are at most 100 retained preparations per owner; no automatic pruning or
silent eviction is implemented. Replay, preview and enqueue require the same current
conversation selection revision, grants, full active-version inventory and a packet
age of at most 15 minutes. Edits/regrant require a new preparation and review.
Nothing silently regenerates a reviewed packet.

Enqueue rechecks under the owner membership lock and encrypts a separate run copy.
Subsequent source edits cannot alter frozen inputs. Current grants and conversation
selection are checked at durable execution and immediately before each new round-0
submission. Revocation fences new calls; already submitted calls cannot be recalled.
An identical acknowledged run retry returns the existing run without a new call.
Uncertain provider outcomes retain the existing explicit resolution boundary.

Every first-round member receives the same bounded packet as untrusted JSON data,
never original bytes or the full source inventory. The instruction forbids following
embedded instructions, expanding scope, accessing tools or writing to a service.
Round 0 remains independent. Reviews receive peer claims rather than resending the
packet or originals, and explicitly cannot claim independent source verification.
Source-supported truth, actual citation entailment and injection robustness are
still empirical DA-126 gates, not guaranteed by an instruction.

## Retention, continuation and exports

`knowledge_preparations.packet_ciphertext` is authenticated by preparation UUID and
immutable via SQL trigger. `runs.knowledge_packet_ciphertext` authenticates the exact
run copy. Run inspection, explicit JSON/Markdown report and conversation exports
retain those frozen quotes and coverage. Exports contain plaintext sensitive content;
original library bytes stay outside them. Current selection availability is separate
from historical delivery provenance.

New-question continuation does not automatically resend old source packets: the
owner prepares/reviews a new packet or proceeds without one. Past report text may
still contain source quotations/citations and is separately inspected as continuation
context. Selected-member reruns explicitly reuse the frozen packet and still require
current permission; copied member outputs remain marked as copies. Schedules with a
selected/pending packet are disabled rather than silently dropping sources.

Preparations and library versions survive run retention. Empty-conversation deletion
blocks retained preparation references. Source/preparation erasure is future reviewed
lifecycle work; deleting a run is not a promise to erase these independent copies.
The exhaustive backup audit rejects partial schema eras, checks ownership/conversation
membership and resolves each packet quotation against the immutable source version.
The generated-only restore helper also checks revoked access and historical readability.
Migration 0052 is additive and has not been applied to the owner's database.

[Verification](DA122_ACCEPTANCE.md), [source foundation](LOCAL_KNOWLEDGE_SOURCES.md),
[trial protocol](evaluation/KNOWLEDGE_EVALUATION.md), [ADR-0037](adr/0037-reviewed-local-knowledge-packets.md).
