# SDD ledger — plan: docs/superpowers/plans/2026-09-21-threejs-robot-arena.md

Setup: Git worktree and SDD helper scripts are unavailable because the project is not a Git repository; implementation will run in the authorized current workspace.
Setup: Node.js and npm are unavailable; JavaScript behavior tests will run in a real browser through a dedicated HTML test harness served by Python.
Pre-flight: Task 1 produces ARENA and buildArenaState(dice); Task 2 consumes the same names and object fields — clean.
Pre-flight: Task 2 produces the browser page and controls; Task 3 consumes them through browser verification — clean.
Task 1: Ruling: replace package.json and Node test runner with tests/arena-state.test.html — Node.js is absent, while browser modules exercise the real JavaScript — cost if wrong: tests require a browser and local server rather than one CLI command.
Task 1: complete (no Git commits available, tests: browser test harness → 4/4 pass).
Task 2: Ruling: replace the iframe UI test harness with direct browser automation — the in-app browser isolates iframe DOM access even on localhost, so the harness cannot observe a loaded app — cost if wrong: UI verification lives in the execution record rather than a reusable HTML test file.
Task 2: Finding: the default +Y camera up-vector was nearly parallel to the overhead viewing direction and flipped the map vertically; the later -Z north ruling replaces the first attempted orientation.
Task 2: Ruling: use -Z as map north and clockwise rotations as negative Y — this preserves screen-right as +X in a top-down right-handed camera while matching Start at upper-right and Exit at lower-left — cost if wrong: future route coordinates must follow the documented -Z north convention.
Task 2: complete (no Git commits available, browser verification: scene ready, 6 options per die, live status updates, camera buttons and randomize work, console 0 errors/0 warnings).
Task 3: Ruling: replace Node syntax checks with successful native browser module loading plus an empty browser error/warning log — Node.js is unavailable — cost if wrong: there is no separate command-line parser check, though the shipping browser parsed and executed both modules.
Task 3: complete (no Git commits available, tests: calculation harness 4/4; browser widths 1280×800 and 390×844 fit without horizontal overflow; dice 1–6 verified; console 0 errors/0 warnings).
Final: fixed narrow-screen top camera clipping — camera fit test RED→GREEN, suite 7/7; 320×844 top-view screenshot shows all four field edges.
Final: fixed stale loading error overlay and WebGL message overwrite — delayed-ready and terminal-failure tests RED→GREEN, suite 7/7.
Final: minor (deferred): body min-width causes about 15px horizontal overflow at a 320px viewport with a classic scrollbar.
Final: minor (deferred): obstacle labels do not follow their boxes and the bonus strip has no direct label.
Final: Ruling: exact correspondence with the physical arena remains based on documented approximations because exact source geometry is unavailable — cost if wrong: obstacle origins may need adjustment after measuring the real field.
Final: Ruling: route planning, collision simulation, and robot animation remain outside this approved first version — cost if wrong: users cannot simulate a complete run until a later version.
Final: Ruling: Node tests and Git commits remain replaced by browser verification and the ledger because neither Node.js nor a valid Git repository exists — cost if wrong: verification and change history are less portable.
Final: Ruling: retain this plan workspace because no Git history exists to preserve its execution record — cost if wrong: the project contains a small internal progress file.
Final review: independent reviewer completed; 0 Critical, 2 Important fixed in one RED→GREEN pass, 2 Minor deferred.
