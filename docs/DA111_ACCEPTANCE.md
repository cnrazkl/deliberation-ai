# DA-111 acceptance

Owner-requested sidebar, separate settings/schedules, progressive disclosure and light/dark/system appearance.

Two dedicated browser cases verify desktop navigation and mobile history, draft preservation,
linked latest schedule output, saved conversation opening, zero persisted API writes,
explicit new chat and appearance persistence/system preference. Existing behavioral
cases now use visible menu and disclosure interactions. Initial layout regressions in
old test selectors were corrected before the final suite.

281 offline units and all 33 browser cases pass in the complete sweep. Two focused cases then verify unavailable output recovery and desktop/mobile theme behavior. Workspace type checks, zero-warning lint and separate-output build pass. Interactive 3000 remains HTTP 200 with ready DB/one worker after test 3100 closes. No schema/provider adapter changes, migration, owner deletion or paid
provider call are part of this increment. [Design](UI_DESIGN.md).
