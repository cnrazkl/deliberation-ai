# Workspace design principles — DA-111 / DA-112

DA-113 adds a labelled per-send private output selector. Editing removes the old preview
and approval; uncertain send retries lock editing and retain the reviewed cap. Stored
receipts show their approved cap separately from observed usage. The setting is a draft,
not a persisted global preference. [Contract](PRIVATE_DELIVERY_SETTINGS.md).

Verified design scope: owner-requested layout and appearance, 3 October 2026.

## Responsive corrections — DA-112, 4 October 2026

- Form and result layouts respond to the **usable main column** through the named
  `workspace` inline-size container. Viewport media queries govern the outer sidebar;
  a visible sidebar must not leave desktop form grids squeezed into a narrow column.
- Grid/flex children can shrink. Long filenames, URLs and labels wrap without hiding
  page overflow. Checkboxes retain their native width instead of inheriting text-field width.
- Attachments have a visible keyboard-accessible **Dosya seç** button invoking the
  existing file input. Selection, validation, per-member consent and removal stay intact.
- Mobile controls use 16px input text and 44px button/summary targets. Sidebar content
  remains scrollable on short screens. Narrow cards reduce padding, not text size.
- Acceptance includes expanded chat/settings/schedule panels at 320, 390, 640, 820,
  1024 and 1440 CSS pixels, a 390px-high landscape layout and 2x CSS magnification.
  Reduced CSS viewports also exercise browser-zoom reflow; CSS magnification is not
  a claim of native browser zoom or physical iOS/Android device testing.
- Check element-level overflow, long accepted filenames, native file chooser activation,
  light/dark screenshots and draft/navigation behavior. A collapsed-home screenshot
  alone is insufficient responsive acceptance.

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
