# DA-112 responsive frontend corrections

Owner request: fix overflowing text while resizing/magnifying, expose a file selection
button and make the workspace usable on phones. Date: 4 October 2026.

## Causes and changes

The previous viewport breakpoint ignored the 292px sidebar, leaving multi-column forms
inside a narrow main area. Several grid/flex children retained intrinsic minimum widths.
Member inputs also applied full width to attachment-consent checkboxes. The native file
control did not provide a distinct styled selection button.

The main column now owns container-based layout breakpoints. Intrinsic children shrink,
long content wraps, checkbox widths stay native and mobile inputs/targets have usable
sizes. A visible native button opens the existing file picker; validation, attachment
consent, encryption and dispatch semantics are unchanged. Sidebar overflow remains
scrollable on short screens. No page-level clipping is used to conceal overflow.

## Verification scope

Read-only fixture tests expand chat, provider/MCP/worker settings and scheduling at
320/390/640/820/1024/1440 CSS px. They inspect element bounds and internal overflow,
select a valid image through the actual file chooser and retain a long accepted filename.
Additional cases cover 820x390 landscape and 2x CSS magnification at 1440px. This models
reflow and magnification; native browser zoom and physical mobile devices were not tested.
Light/dark screenshots are generated with synthetic content. Existing navigation/theme
tests retain their assertions, and the council flow checks populated reports at 320/820px.

Initial expanded checks found real checkbox and risk-picker overflow; both were fixed.
An initial fixture filename exceeded the application limit and was corrected. One focused
file-chooser wait timed out; the final suite result is recorded in CURRENT_STATE.md.

Final checks: 281 unit tests, all 40 browser tests, one additional populated-report
responsive repeat, workspace/script type checks, zero-warning lint and isolated-output
production build passed. Mobile attachment and expanded settings screenshots were
visually inspected. After test teardown port 3000 returned HTTP 200, PostgreSQL was
ready and exactly one application worker had a current heartbeat.

No migrations, real owner deletion or paid provider requests are part of this increment.
The interactive runtime was unavailable during verification; portable PostgreSQL and
the independent hidden `pnpm dev` launcher were started. This recovers availability,
without claiming a newly proven cause or permanent startup mechanism.
