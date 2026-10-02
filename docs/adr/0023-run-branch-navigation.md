# ADR-0023: Authenticated run links for branch navigation

Accepted locally: 1 October 2026, DA-092.

Flat saved history cannot navigate multiple continued questions and selected-member reruns. An inherited continuation is not always a rerun's immediate source, and decrypting the entire history on each screen load would grow with every saved run.

Index immediate source UUID and kind beside authenticated run provenance. New enqueue transactions freeze both together. Backfill legacy links in bounded authenticated batches without changing inputs/reports; keep navigation closed while owned pending rows remain. Validate projected links and scope rows/cursors to the owner.

Avoid an ancestor foreign key: source retention must preserve descendants and their frozen history. Mark missing sources explicitly while keeping owned sibling navigation. Bound ancestors and paginate children/siblings. Opening links changes only inspected results, preserving drafts and provider execution.

A durable conversation aggregate, conversation-wide export and branch editing remain separate work. [Contract](../RUN_BRANCHES.md).
