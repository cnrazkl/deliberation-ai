# Workspace design principles — DA-111

Verified design scope: owner-requested layout and appearance, 3 October 2026.

## Information architecture

The application opens in Sohbet. A persistent left sidebar contains the conversation
library, saved-run history, new-chat action and three navigation destinations:

| Destination | Contents |
| --- | --- |
| Sohbet | Question composer, current council, selected context, clarification drafts and results |
| Zamanlayıcı | Current question snapshot preview, schedule creation/management and linked latest outputs |
| Ayarlar | Provider connections, local MCP configuration/results, unresolved provider operations, DB/worker diagnostics and appearance |

The sidebar scrolls independently of the main content. On small screens it becomes a
menu opened from the top bar; selection closes it. Conversation options are secondary
disclosures. Private branches and conversation deletion reviews opened from history
use the main content area, preserving space for reading and explicit acknowledgement.
Saved-run removal remains available in run history.

## Progressive disclosure

Default chat shows the question and primary action. Detailed council configuration,
prompt revision, attachments, token/context inspection, standard risk explanation,
execution limits and memory start collapsed. Their controls remain available through
native keyboard-operable disclosures. Selected counts and enabled limits are shown in
summaries. High-risk controls/warnings, invalid configuration and preview failures
remain visible. An Ayarlar count surfaces unresolved provider operations.

No member becomes a chair. Minority views, raw replies, provenance, exports and
reviewed deletion remain inspectable. Visual simplification must not imply agreement
is accuracy or suppress blocked/risky state.

## State and actions

Navigation hides views without unmounting their editors. Question/model choices,
attachment selections, retry identities and active watches survive switching views.
Opening history or schedule output opens the existing run without changing the question
or issuing generation. Navigation does not pause schedules or terminate a worker.
The local badge identifies the workspace; actual readiness belongs to diagnostics.

Yeni sohbet is an explicit fresh composer action: it clears the current question,
attachments, selected memory/tool context and continuation/private selection while
keeping council choices. It stops the current page watch, not stored run execution.
It is disabled during submission/continuation loading. Browser reload retains saved
history and appearance; unsaved drafts are not claimed to survive reload.

Schedule outputs show each retained schedule's latest linked run. The view does not
claim a complete per-schedule archive; older runs remain in the existing run history.
Missing/pruned output is reported as unavailable when opening fails.

## Appearance and accessibility

Use semantic CSS tokens for paper/surface/border/text/accent and distinct risk,
error, source and private-branch colors. Both light and dark themes cover forms,
reports, details and settings; native controls use the corresponding color-scheme.
Sistem teması follows OS preference. Açık tema and Koyu tema override it and are saved
under the non-sensitive deliberation-theme browser key. A constant pre-paint layout
script reads only that preference to avoid a light flash; tabs synchronize changes.
No prompt, credential or report content is stored in browser appearance preferences.

Visible keyboard focus, native buttons/disclosures, a skip link and readable muted text
are required. Menu navigation focuses the main heading; mobile Escape/close returns
focus to the menu trigger. Respect reduced motion and avoid horizontal overflow at
390 px. Navigation labels describe user activities rather than storage/queue internals.

## Verification

Acceptance covers desktop and 390 px mobile layout, hidden non-chat views, sidebar
opening, draft preservation, existing history/schedule output opening without generation,
explicit new chat, theme overrides, reload persistence and system dark preference.
The complete existing browser suite is exercised using explicit navigation/disclosures.
Screenshot fixtures contain generated content only. See [acceptance](DA111_ACCEPTANCE.md).
