# Chorus review — 2026-11-10

- **Target**: PR #48 screenshot support in problem briefs
- **Mode**: design review of the PR's approach, not a line-by-line diff review

**Round context.** Mode: design review of the PR's approach, not a line-by-line diff review. PR #48 (branch worktree-fix-46-47-visuals, draft, closes issues #46 and #47) adds screenshot support to problem briefs. Deltas: (1) schema/problem-brief.schema.json — new diagram kind "image" (PNG/JPEG/WebP, required alt + caption, optional fileDark) and an optional "image" object on evidence items; (2) bin/validate-brief.mjs — checkImage() refuses missing/non-raster/>1 MB pictures when given a baseDir, warns above 6 MB total, and warns when a live entry's prose or evidence mentions .html/.png/.svg/mockup/screenshot and carries no image or svg; validateBrief gains a third baseDir parameter; (3) bin/render-brief.mjs — shot() embeds pictures as base64 data URIs inside a <button class="shot">, images grouped in a wrapping .shots row, a click toggles .zoom, dark/light swap by CSS; (4) bin/brief.mjs — --diagram list flag on raise and set (set appends to unwound.diagrams), validation now receives the brief's folder; (5) bin/extract-brief.mjs — writes embedded pictures back to files beside the recovered JSON, refusing paths that climb out of that folder; (6) SKILL.md, reference/entry-format.md, reference/diagrams.md, README.md — rule: show the reader what they must see; a path or markup line is not evidence for a visual question. Not done: no image resizing (zero-dependency scripts). Tests: 104 pass incl. 4 new. Zero-dependency Node 18+ project; no Python. No prior chorus record exists.

**Bindings.** decision-sink: problem-brief · ruling-lookup: problem-brief · record-validator: chorus-core · record-renderer: chorus-core · arbiter: default · fixed-viewpoint: default · memory-recall: default

**Recovered without asking.** retry — uncle-bob-architect (rsvp): (root): the reply is 82 words; the limit is 80; retry — mark-richards-architect (rsvp): (root): the reply is 88 words; the limit is 80; retry — alan-cooper-advisor (rsvp): (root): the reply is 81 words; the limit is 80; retry — delivery-and-ops-advisor (rsvp): (root): the reply is 90 words; the limit is 80; retry — security-and-trust-advisor (rsvp): (root): the reply is 81 words; the limit is 80; retry — test-strategy-advisor (rsvp): (root): the reply is 94 words; the limit is 80; retry — uncle-bob-architect (author): (root): the report is 728 words of prose; the limit is 700; retry — kent-beck-persona (author): (root): the report is 793 words of prose; the limit is 700; retry — don-norman-advisor (author): findings[1] → evidence[2] → ref: "test/brief.test.mjs" is not the right shape; (root): the report is 822 words of prose; the limit is 700; retry — uncle-bob-architect (vote): votes[3] → pull_quote: is too short — 0 characters, at least 5; votes[3] → pull_quote: "" is not the right shape; votes[6] → pull_quote: is too short — 0 characters, at least 5; retry — kent-beck-persona (vote): votes[2] → pull_quote: is too short — 0 characters, at least 5; votes[2] → pull_quote: "" is not the right shape; votes[4] → pull_quote: is too short — 0 characters, at least 5; retry — mark-richards-architect (vote): (root): the report is 678 words of prose; the limit is 600

**Secret filter.** not run (No memory writes went through the conductor this round.).

## 1. TL;DR

Five lenses found PR #48 delivers screenshots inside the page, but the recovery step that writes pictures back from a published page trusts that page too far, the phone tap does the opposite of the operator's ruling, and the visual-pointer warning guards wording instead of intent. The top five fix extract first (refuse non-picture and dot-segment names, never overwrite, with a hostile-page test), then fit-to-screen tap with full-screen pinch-zoom, then replace the keyword warning with a per-evidence rule that intent to show must carry the picture. Three 🔴 findings block merge: F1 (extract writes any file a page names), F8 (extract silently overwrites existing pictures) and F15 (no test fails if the folder-escape refusal is removed).

## 2. Roster (this round)

| Lens | Persona | Decision | Applies (cited deltas) | Expected stakes | Seat | Reason |
|---|---|---|---|---|---|---|
| DDD | eric-evans-advisor | JOIN | schema: screenshot added as diagram kind "image" and also as evidence.image; validator word-match heuristic (.png/mockup/screenshot) standing in for 'visual question' | 🟡-potential — One concept, a screenshot, gets two homes: it is filed under 'diagram' and attached to evidence, so the brief's language blurs what is evidence and what is illustration. | not seated | The PR reshapes the brief's Published Language (the schema), and that language now names a screenshot two different ways. |
| architecture | mark-richards-architect | JOIN | schema: new image kind and evidence image (JSON contract); validateBrief third baseDir parameter; picture rules across validate, render, extract: duplicate authority? | 🟡-potential — Raster, size and path rules live in three scripts; who owns them? | ordinary | Schema contract change plus one picture rule spread over three scripts is coupling ground. |
| adversarial product | alan-cooper-advisor | JOIN | checkImage(): 1 MB hard refusal, no resizing, excise lands on the brief author; keyword warning (.png/mockup/screenshot) deciding what the operator must see; shot(): click-to-zoom and dark/light swap as the operator's viewing experience | 🟡-potential — 1 MB refusal without resize path; keyword warnings may cry wolf | ordinary | The PR's goal is what the brief's operator must see; that is my seat. |
| human-centred design | don-norman-advisor | JOIN | render-brief shot(): <button class="shot"> click-to-zoom toggle and CSS dark/light swap; validate-brief checkImage() refusals and the keyword-based 'mentions screenshot but carries no image' warning; schema image kind: required alt + caption; extract-brief writing pictures back beside recovered JSON | 🟡-potential — zoom affordance is a bare button with no visible signifier; keyword warning may misfire and teach users to ignore it | ordinary | The PR changes what the brief's reader sees and what feedback the author gets from validation, which is feedback and signifier territory. |
| clean code | uncle-bob-architect | JOIN | validateBrief gains baseDir: pure validation now does disk I/O; checkImage() mixes file refusal, size budget and prose heuristic; set --diagram silently appends to unwound.diagrams; extract-brief now writes files | 🟡-potential — validateBrief(brief, schema, baseDir) has two reasons to change | ordinary | New functions and parameters cross the pure/effectful line my lens reviews. |
| TDD and simple design | kent-beck-persona | JOIN | 4 new tests across 331 changed lines: which of checkImage, shot(), --diagram append, and extract write-back each one corners; render-to-extract image round-trip: is it tested with both real producers, or is one side a fixture; image raster/size rule split between schema and validator: can a test see the two disagree | 🟡-potential — 4 tests for 5 behavioural deltas, one of them a path-escape refusal | ordinary | New branches went into validator, renderer, CLI and extractor; whether the tests pin each one is my ground. |
| test strategy | test-strategy-advisor | JOIN | validateBrief baseDir image checks and warnings; extract-brief path-escape refusal; render/extract data-URI round trip | 🟡-potential — 4 new tests for five changed scripts; which risks have a fast check? | not seated | New file validation, a path guard and an embed round trip each need a check placed. |
| delivery and ops | delivery-and-ops-advisor | JOIN | shot() base64 embeds inflate the page ~33% past checkImage() caps; validateBrief baseDir: does every caller pass it?; extract-brief picture write-back round trip | 🟢-potential — 6 MB raw warn means ~8 MB page; is it a real gate? | not seated | Page size and the validator gate change what publishing costs to run. |
| security | security-and-trust-advisor | JOIN | extract-brief.mjs writes page pictures to disk; path-climb refusal; render-brief.mjs shot() puts bytes, alt, caption into HTML; checkImage()/render embed any baseDir-resolved path in a shared page | 🟡-potential — untrusted page content written to disk; local files embedded in published pages | not seated | Data crosses two boundaries: page to disk, and disk to a shared page. |
| constraint and flow | eliyahu-goldratt-advisor | JOIN | validate-brief.mjs: 1 MB refusal, 6 MB warning, prose-mention heuristic warning; extract-brief.mjs: picture write-back with path-climb refusal; one PR bundling two issues (#46, #47) across 11 files | 🟡-potential — Several guards (size caps, mention heuristic, extract write-back) may armor a mostly single-operator tool before any brief has carried a screenshot | not seated | The core verdict is whether the reader sees the picture; I would sort which of the added guards earn their place and which can be cut. |

Joiners: 10. Quorum: proceed. Seating decision: seating-1.

**Operator interview.** 1 session(s), 12 question(s), 2 of them gates.

- [gate] mark-richards-architect (project-wide): Which quality matters most for problem-brief: (a) the operator can answer an entry from the published page alone, often on a phone; (b) the brief's JSON can be rebuilt from its published page; (c) zero dependencies and portable scripts; (d) the JSON stays readable and diffable? — "Readable page first: (a) page answerable on a phone > (b) recovery > (c) zero dependencies > (d) diffable JSON."
- [gate] mark-richards-architect (project-wide): Who should the reviewers judge problem-brief as being built for: one operator, or public users through install.sh? — "Public users: a tool shipped publicly through install.sh, used by people other than the author."
- alan-cooper-advisor (lens-specific): On a phone, when you tap a screenshot in a brief, what should happen? The PR shows it at true pixel size with sideways scrolling. — "Fit, pinch to zoom: keep it fitted to the screen width; open it fitted in a full-screen view where you pinch to zoom."
- don-norman-advisor (project-wide): Should an evidence screenshot have its own required caption, as issue #47 asked? The PR uses the evidence note as the caption. — "Note is caption: keep the PR's choice; the evidence note already says what the picture shows."
- alan-cooper-advisor (project-wide): Does a typical session have any way to resize an image before the 1 MB refusal? — deferred
- alan-cooper-advisor (lens-specific): How often do live entries mention 'screenshot' or '.png' with no visual question behind them? — deferred
- don-norman-advisor (lens-specific): Does the artifact frame let the click toggle and the page's horizontal scroll work on a phone? — deferred
- uncle-bob-architect (lens-specific): Is refusing a bad screenshot at validation while degrading a bad svg/archify drawing to a note at render time a deliberate split? — deferred
- uncle-bob-architect (lens-specific): Is the data-brief-file markup that extract-brief parses a stable contract between render and extract, or an internal detail? — deferred
- kent-beck-persona (lens-specific): Does the project expect test-first, or only that a test lands with the change? — deferred
- kent-beck-persona (project-wide): Is git show HEAD the intended scope, given local main is behind the PR's parent? — deferred
- mark-richards-architect (lens-specific): Issue #47 asked for a warning when the rendered page passes 8 MB; the PR warns when raw image bytes pass 6 MB. Was that change deliberate? — deferred

Deferred answers cost: Eight non-gate questions were deferred. Findings that depend on them state their assumption: no resizing tool exists in a session; the keyword warning's false-positive rate is unknown; phone behaviour in the artifact frame is read from CSS, not run; the refuse-versus-degrade split and the render-extract markup coupling are judged on the code alone; tests are expected to land with the change; scope is the PR's single commit; the 6 MB raw threshold is judged as written.

## 3. Findings register

| ID | Advisor · Lens | Authored severity | Target (locator) | Pull-quote (verbatim) | confidence_on_hand | need_info · reason | graded |
|---|---|---|---|---|---|---|---|
| F1 | mark-richards-architect · architecture | 🔴 | `bin/extract-brief.mjs:45-55` | "Extract trusts a stranger's page to name files, and the picture-type rule never reaches it; I got it to write .claude/settings.json." | high | — | true |
| F2 | mark-richards-architect · architecture | 🟡 | `bin/render-brief.mjs:21-24` | "Two scripts each guard a slice of the page budget, and neither guards the 16 MB that publishing enforces; put one total in the validator and refuse there." | high | — | true |
| F3 | mark-richards-architect · architecture | 🟢 | `bin/validate-brief.mjs:276` | "I withdraw most of this: real screenshots fit under 1 MB and tools to shrink them exist; the cap is just a proxy for the page total in F2." | high | — | true |
| F4 | mark-richards-architect · architecture | 🟢 | `bin/render-brief.mjs:152-160` | "The img markup is a contract with two authors; keep both, but make the round-trip test use a filename that needs escaping so drift goes red." | high | — | true |
| F5 | alan-cooper-advisor · adversarial product | 🟡 | `bin/validate-brief.mjs:276-278` | "A screenshot over 1 MB doesn't only lose the picture: the operator's question never gets raised, and the fix the hint asks for needs a tool nobody shipped." | high | — | true |
| F6 | alan-cooper-advisor · adversarial product | 🟡 | `bin/render-brief.mjs:772-773` | "On a phone, tapping a screenshot to see it better makes it worse: a wide picture you scroll sideways through a narrow slot, the opposite of what the operator ruled." | high | — | true |
| F7 | alan-cooper-advisor · adversarial product | 🟡 | `bin/validate-brief.mjs:349-353` | "The warning stays quiet on the #46 case as soon as the entry also carries any svg, and it fires on every honest code citation of an .html file." | high | — | true |
| F8 | alan-cooper-advisor · adversarial product | 🟡 | `bin/extract-brief.mjs:55` | "Recovering a brief from a page can quietly overwrite the screenshots already sitting in your folder, and nothing tells you it happened." | high | — | true |
| F9 | alan-cooper-advisor · adversarial product | 🟢 | `reference/diagrams.md:49` | "Most of the promise ships; the deferred resizer is paid for by the author on every capture and by the operator's phone data, so price it rather than hide it." | high | — | true |
| F10 | don-norman-advisor · human-centred design | 🟡 | `bin/render-brief.mjs:159` | "On a phone the screenshot looks like a plain picture: its only zoom cues are a hover cursor and a tooltip, so the reader can neither find the action nor see how to undo it." | high | — | true |
| F11 | don-norman-advisor · human-centred design | 🟡 | `bin/validate-brief.mjs:349-356` | "Ask the entry whether the reader must see something, then require the picture; guessing from words both misses the #46 case and nags ordinary briefs." | high | — | true |
| F12 | don-norman-advisor · human-centred design | 🟡 | `bin/validate-brief.mjs:276-279` | "The size refusal tells the author to resize or re-encode, which a session cannot do, and leaves out what it can do: retake the shot narrower or cropped." | high | — | true |
| F13 | don-norman-advisor · human-centred design | 🟡 | `bin/render-brief.mjs:1155-1158` | "Render refuses the page over one picture, where the ruling wants a visible note; refuse at raise and set, degrade on render, and let extract say what the page will show." | high | — | true |
| F14 | uncle-bob-architect · clean code | 🟡 | `bin/render-brief.mjs:152` | "A missing screenshot kills the render, but a missing drawing in the same file degrades to an honest note. One rule, two owners, two outcomes: give pictures one home and one failure policy." | high | — | true |
| F15 | uncle-bob-architect · clean code<br>kent-beck-persona · TDD and simple design (🟡) | 🟡 | `bin/extract-brief.mjs:50` | "The one line that stops a stranger's page from writing outside the folder has no test that fails without it."<br>kent-beck-persona: "The one refusal between a stranger's page and your disk can be deleted and every test stays green." | high | — | true |
| F16 | uncle-bob-architect · clean code | 🟡 | `bin/extract-brief.mjs:45` | "The JSON comes back through a declared contract; the pictures come back through a regex nobody promised to keep. Quality (b) needs both at the same standing." | high | open · don-norman-advisor: Choosing which recovery contract counts as stable is architecture. My lens sees only the consequence, pictures silently lost on recovery, and that is covered by R2-1. | true |
| F17 | uncle-bob-architect · clean code | 🟡 | `bin/validate-brief.mjs:353` | "Stop guessing intent from words. Let the author declare 'the reader must see this', and refuse the entry when the picture is not there." | high | — | true |
| F18 | uncle-bob-architect · clean code<br>kent-beck-persona · TDD and simple design (🟢) | 🟢 | `bin/brief.mjs:150` | "The append rule for --diagram lives in two places in two shapes. One helper, one rule."<br>kent-beck-persona: "set --diagram has a test; raise --diagram has its own merge and none." | high | — | true |
| F19 | uncle-bob-architect · clean code | 🟢 | `bin/validate-brief.mjs:909` | "A validator that reads the disk only when you remember a third positional argument hides its effect and fails open when you forget it." | high | — | true |
| F20 | kent-beck-persona · TDD and simple design | 🟡 | `test/brief.test.mjs:1155-1182` | "The round trip uses one picture for both light and dark, so it would pass with them swapped." | high | — | true |
| F21 | kent-beck-persona · TDD and simple design | 🟢 | `bin/extract-brief.mjs:45-46` | "The renderer writes the picture tag and the extractor parses it back with its own regex and decoder: one rule, two copies." | high | — | true |
| F22 | kent-beck-persona · TDD and simple design | 🟢 | `bin/validate-brief.mjs:382` | "The warning that comes before a too-heavy page has never been made to fire." | high | — | true |
| F23 | kent-beck-persona · TDD and simple design | 🟢 | `bin/validate-brief.mjs:269-271` | "Without a folder the validator says yes to pictures that are not there, and says nothing about it." | high | — | true |
| F24 | kent-beck-persona · TDD and simple design | 🟡 | `test/brief.test.mjs:1196-1202` | "The guard's only test pins the wording rule the operator just rejected; rewrite it red first so intent-to-show becomes the spec." | high | — | true |
| R2-1 | mark-richards-architect · architecture | 🟢 | `schema/problem-brief.schema.json:521-545` | "The schema spells the picture twice; give it one $def and let both places point at it." | high | — | false [ungraded] |
| R2-2 | alan-cooper-advisor · adversarial product | 🟡 | `bin/brief.mjs:322-323` | "After a screenshot goes missing, the tool keeps taking rulings and silently stops publishing them; the operator is left reading yesterday's page." | high | — | false [ungraded] |
| R2-3 | don-norman-advisor · human-centred design | 🟡 | `bin/extract-brief.mjs:58-59` | "Printing the recovered JSON quietly leaves the pictures behind, and the user only finds out when the render fails on files nobody mentioned." | high | — | false [ungraded] |
| R2-4 | uncle-bob-architect · clean code | 🔴 | `bin/extract-brief.mjs:45` | "Extract is the third owner of the picture rule and enforces the smallest part of it. Give the rule one function and make all three scripts call it." | high | — | false [ungraded] |
| R2-5 | kent-beck-persona · TDD and simple design | 🔴 | `bin/extract-brief.mjs:45-55` | "The test that corners extract must plant a settings file inside the folder, not only ../; otherwise F1's fix ships unpinned." | high | — | false [ungraded] |
| R2-6 | kent-beck-persona · TDD and simple design | 🟢 | `bin/render-brief.mjs:152-161` | "Before fixing the phone tap and the failure policy, make shot() testable without a subprocess." | high | — | false [ungraded] |

Converging lenses, in their own words:

- **R2-1** (derived from F14)
- **R2-2** (derived from F14)
- **R2-3** (derived from F13)
- **R2-4** (derived from F1)
- **R2-5** (derived from F1)
- **R2-6** (derived from F14)

## 4. Consolidation matrix

`net = P − O` over non-author voters (CONFIRM excluded); `T = max(1, floor(N / 2))`; convergence = P + C.

| ID | Authored severity | P | C | O | net | Final severity | Convergence (P + C) | Status |
|---|---|---|---|---|---|---|---|---|
| F1 | 🔴 | 0 | 4 | 0 | 0 | 🔴 | 4 | graded |
| F2 | 🟡 | 0 | 4 | 0 | 0 | 🟡 | 4 | graded |
| F3 | 🟢 | 0 | 4 | 0 | 0 | 🟢 | 4 | graded |
| F4 | 🟢 | 0 | 2 | 0 | 0 | 🟢 | 2 | graded |
| F5 | 🟡 | 0 | 3 | 0 | 0 | 🟡 | 3 | graded |
| F6 | 🟡 | 0 | 4 | 0 | 0 | 🟡 | 4 | graded |
| F7 | 🟡 | 0 | 4 | 0 | 0 | 🟡 | 4 | graded |
| F8 | 🟡 | 2 | 2 | 0 | 2 | 🔴 | 4 | graded |
| F9 | 🟢 | 0 | 2 | 0 | 0 | 🟢 | 2 | graded |
| F10 | 🟡 | 0 | 4 | 0 | 0 | 🟡 | 4 | graded |
| F11 | 🟡 | 0 | 4 | 0 | 0 | 🟡 | 4 | graded |
| F12 | 🟡 | 0 | 3 | 0 | 0 | 🟡 | 3 | graded |
| F13 | 🟡 | 1 | 3 | 0 | 1 | 🟡 | 4 | graded |
| F14 | 🟡 | 1 | 3 | 0 | 1 | 🟡 | 4 | graded |
| F15 | 🟡 | 1 | 1 | 0 | 1 | 🔴 | 2 | graded |
| F16 | 🟡 | — | — | — | — | — | — | held |
| F17 | 🟡 | 0 | 4 | 0 | 0 | 🟡 | 4 | graded |
| F18 | 🟢 | 0 | 1 | 0 | — | 🟢 | — | minority-report |
| F19 | 🟢 | 0 | 3 | 0 | 0 | 🟢 | 3 | graded |
| F20 | 🟡 | 0 | 2 | 0 | 0 | 🟡 | 2 | graded |
| F21 | 🟢 | 0 | 2 | 0 | 0 | 🟢 | 2 | graded |
| F22 | 🟢 | 0 | 2 | 0 | 0 | 🟢 | 2 | graded |
| F23 | 🟢 | 0 | 2 | 0 | 0 | 🟢 | 2 | graded |
| F24 | 🟡 | 0 | 4 | 0 | 0 | 🟡 | 4 | graded |
| R2-1 | 🟢 | — | — | — | — | 🟢 | — | ungraded [ungraded] |
| R2-2 | 🟡 | — | — | — | — | 🟡 | — | ungraded [ungraded] |
| R2-3 | 🟡 | — | — | — | — | 🟡 | — | ungraded [ungraded] |
| R2-4 | 🔴 | — | — | — | — | 🔴 | — | ungraded [ungraded] |
| R2-5 | 🔴 | — | — | — | — | 🔴 | — | ungraded [ungraded] |
| R2-6 | 🟢 | — | — | — | — | 🟢 | — | ungraded [ungraded] |

## 5. Conflicts

- **C1** — mark-richards-architect vs alan-cooper-advisor on F3, F5: Is the 1 MB per-picture cap a real obstacle? Richards (F3, now 🟢): this machine can resize, so the cap is reachable. Cooper (F5, 🟡): the author meets a hard stop whose hint names no tool, and the operator's question is never raised. Outcome differs: a refusal the author can act on, or a stop with no way forward.
  - Unresolved for the operator (conflict-1)
- **C2** — mark-richards-architect vs don-norman-advisor on F3, F12: Same cap, Norman's side. Richards (F3, now 🟢): resizing tools exist here. Norman (F12, 🟡): the refusal hint tells the author to resize, which public users may not be able to do, and leaves out retaking the shot narrower or cropped. Outcome differs: whether the message leads the author to a fix.
  - Unresolved for the operator (conflict-2)
- **C3** — mark-richards-architect vs uncle-bob-architect on F4, F16, R2-4: Where should the picture rule live? Richards (F4): keep render and extract copies of the img markup, pinned by the round-trip test. Uncle Bob (R2-4, F16): one function that validate, render and extract all call. No direct user-visible change; it sets how likely a later edit silently breaks recovering pictures.
  - Unresolved for the operator (conflict-3)
- **C4** — mark-richards-architect vs kent-beck-persona on F4, F21: Same question, Beck's side. Richards (F4): two copies are a sanctioned divergence, since extract importing the renderer would run its CLI. Beck (F21): the picture tag is one rule written twice; move it in a structure-only commit first. No direct user-visible change.
  - Unresolved for the operator (conflict-4)

## 6. Top five

1. **F1** 🔴 — "Extract trusts a stranger's page to name files, and the picture-type rule never reaches it; I got it to write .claude/settings.json." `bin/extract-brief.mjs:45-55`
   Cost low · Value: Closes the only attacker-reachable write: a page someone else published can no longer name a non-picture file (e.g. .claude/settings.json) for extract to write. Unblocks merge (🔴). · Convergence 4
2. **F15** 🔴 — "The one line that stops a stranger's page from writing outside the folder has no test that fails without it." `bin/extract-brief.mjs:50`
   Cost low · Value: Pins the F1 fix with a test that goes red if the path and type refusals are removed, so the guard cannot silently regress. Unblocks merge (🔴). · Convergence 2
3. **F8** 🔴 — "Recovering a brief from a page can quietly overwrite the screenshots already sitting in your folder, and nothing tells you it happened." `bin/extract-brief.mjs:55`
   Cost low · Value: Stops recovery from silently overwriting screenshots already beside the JSON; the operator's own files are never lost to a page. Unblocks merge (🔴). · Convergence 4
4. **F6** 🟡 — "On a phone, tapping a screenshot to see it better makes it worse: a wide picture you scroll sideways through a narrow slot, the opposite of what the operator ruled." `bin/render-brief.mjs:772-773`
   Cost medium · Value: Delivers the operator's ruling on the top-ranked quality: on a phone a tapped screenshot opens fitted in a full-screen view with pinch-zoom, instead of a true-size strip scrolled sideways. · Convergence 4
5. **F11** 🟡 — "Ask the entry whether the reader must see something, then require the picture; guessing from words both misses the #46 case and nags ordinary briefs." `bin/validate-brief.mjs:349-356`
   Cost medium · Value: Replaces the wording heuristic with the operator's rule (intent to show must carry the representation): fewer false warnings for public users, and the #46 case is caught per evidence item, not silenced by an unrelated svg. · Convergence 4

## 7. Held findings and minority reports

- **F16** (route: operator): don-norman-advisor — Choosing which recovery contract counts as stable is architecture. My lens sees only the consequence, pictures silently lost on recovery, and that is covered by R2-1.

**Minority reports** (one voter each; not counted, never gating, authored severity kept):

- **F18** 🟢 — "The append rule for --diagram lives in two places in two shapes. One helper, one rule." `bin/brief.mjs:150` (P 0 · C 1 · O 0)

## 8. Next-chorus baseline

**Assume closed**: none

**In progress**: F1, F8, F15: extract hardening and its hostile-page test; F6, F10: fitted phone view with visible enlarge and close cues; F11, F17, F24, F7: intent-to-show rule replaces the keyword warning; F13, F14: refuse a bad picture at brief raise/set, degrade to a note on render

**Re-evaluate**: C1: whether the 1 MB per-picture cap stays once the page total is enforced (F2, F3, F5, F12); C2: one owner for the picture rule versus two copies pinned by the round-trip test (F4, F16, F21, R2-4); Security-and-Trust was not seated this round although extract now writes files from a published page; seat it next round

### Decisions

#### seating-1 — Seating tie at seat 5: default panel seated (🟡)

10 personas joined for 5 ordinary seats; the two-axis signal (cited deltas, then expected stakes) ties across seat 5.

- **Point**: RSVP seating — tie at the cap (catalog row 2)
- **Sensor**: strict order at the cap boundary (DECISION-PRIMITIVE.md § Seating) → tie (mark-richards-architect, alan-cooper-advisor, don-norman-advisor, uncle-bob-architect, kent-beck-persona)
- **Resolution**: default-applied · **Status**: complete
- **Default** — Seat the sorted panel (`sorted-panel`): Seat mark-richards-architect, alan-cooper-advisor, don-norman-advisor, uncle-bob-architect, kent-beck-persona. *Cost*: none
- Swap a tied seat (`swap-seat`): Re-seat one tied persona in place of another and re-run the board. *Cost*: re-run the board
- **Override**: Name the tied persona to seat instead; the board re-runs. (cost: one board re-run)
- **Chosen**: `sorted-panel` on 2026-11-10
- **Evidence**: conduct.mjs seat()

#### conflict-1 — C1: mark-richards-architect, alan-cooper-advisor disagree on F3, F5 (🟡)

Is the 1 MB per-picture cap a real obstacle? Richards (F3, now 🟢): this machine can resize, so the cap is reachable. Cooper (F5, 🟡): the author meets a hard stop whose hint names no tool, and the operator's question is never raised. Outcome differs: a refusal the author can act on, or a stop with no way forward.

- **Point**: Unresolved conflict (Phase 3) (catalog row 15)
- **Resolution**: default-applied · **Status**: open
- **Default** — Let the counted severity stand (`counted-stands`): The vote's arithmetic stands; nothing changes in the ranking. *Cost*: none
- Rule on the disagreement (`operator-rules`): The operator decides which reading holds; the ruling annotates the ranking. *Cost*: one operator ruling
- **Override**: Rule on the conflict; the ruling annotates the ranking and never changes counted severity. (cost: one operator ruling)
- **Evidence**: F3; F5

#### conflict-2 — C2: mark-richards-architect, don-norman-advisor disagree on F3, F12 (🟡)

Same cap, Norman's side. Richards (F3, now 🟢): resizing tools exist here. Norman (F12, 🟡): the refusal hint tells the author to resize, which public users may not be able to do, and leaves out retaking the shot narrower or cropped. Outcome differs: whether the message leads the author to a fix.

- **Point**: Unresolved conflict (Phase 3) (catalog row 15)
- **Resolution**: default-applied · **Status**: open
- **Default** — Let the counted severity stand (`counted-stands`): The vote's arithmetic stands; nothing changes in the ranking. *Cost*: none
- Rule on the disagreement (`operator-rules`): The operator decides which reading holds; the ruling annotates the ranking. *Cost*: one operator ruling
- **Override**: Rule on the conflict; the ruling annotates the ranking and never changes counted severity. (cost: one operator ruling)
- **Evidence**: F3; F12

#### conflict-3 — C3: mark-richards-architect, uncle-bob-architect disagree on F4, F16, R2-4 (🟡)

Where should the picture rule live? Richards (F4): keep render and extract copies of the img markup, pinned by the round-trip test. Uncle Bob (R2-4, F16): one function that validate, render and extract all call. No direct user-visible change; it sets how likely a later edit silently breaks recovering pictures.

- **Point**: Unresolved conflict (Phase 3) (catalog row 15)
- **Resolution**: default-applied · **Status**: open
- **Default** — Let the counted severity stand (`counted-stands`): The vote's arithmetic stands; nothing changes in the ranking. *Cost*: none
- Rule on the disagreement (`operator-rules`): The operator decides which reading holds; the ruling annotates the ranking. *Cost*: one operator ruling
- **Override**: Rule on the conflict; the ruling annotates the ranking and never changes counted severity. (cost: one operator ruling)
- **Evidence**: F4; F16; R2-4

#### conflict-4 — C4: mark-richards-architect, kent-beck-persona disagree on F4, F21 (🟡)

Same question, Beck's side. Richards (F4): two copies are a sanctioned divergence, since extract importing the renderer would run its CLI. Beck (F21): the picture tag is one rule written twice; move it in a structure-only commit first. No direct user-visible change.

- **Point**: Unresolved conflict (Phase 3) (catalog row 15)
- **Resolution**: default-applied · **Status**: open
- **Default** — Let the counted severity stand (`counted-stands`): The vote's arithmetic stands; nothing changes in the ranking. *Cost*: none
- Rule on the disagreement (`operator-rules`): The operator decides which reading holds; the ruling annotates the ranking. *Cost*: one operator ruling
- **Override**: Rule on the conflict; the ruling annotates the ranking and never changes counted severity. (cost: one operator ruling)
- **Evidence**: F4; F21

### Side-notes (flag-only)

- **threshold-boundary**: Moved at exactly the threshold: |net| == T. (F8, F15)

## Appendix — lens reports

- mark-richards-architect: `docs/reviews/2026-11-10-chorus-review-pr48.run.json`
- alan-cooper-advisor: `docs/reviews/2026-11-10-chorus-review-pr48.run.json`
- don-norman-advisor: `docs/reviews/2026-11-10-chorus-review-pr48.run.json`
- uncle-bob-architect: `docs/reviews/2026-11-10-chorus-review-pr48.run.json`
- kent-beck-persona: `docs/reviews/2026-11-10-chorus-review-pr48.run.json`
