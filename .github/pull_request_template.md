<!--
  Keep PRs small and single-purpose. If the checklist below cannot be filled in
  honestly, the change is not ready — open it as a draft instead.
-->

## What

<!-- One paragraph: what the change does. A reviewer should be able to read this
     and know which files matter before opening the diff. -->

## Why

<!-- The behaviour before this change and what was wrong with it. Include the
     concrete symptom (route + status, plugin + log line, in-game effect), not a
     restatement of the diff. This is the part reviewers cannot reconstruct later
     from the code alone. -->

## Which half

- [ ] Web panel (`web-panel/`) — Worker, local Node server, relay, D1/SQLite
- [ ] Game server plugin (`game-server/cstrike/addons/amxmodx/scripting/`)
- [ ] Both (say which side owns the fix)
- [ ] Neither — docs / CI / tooling only

## Checks

Run from the repository root; these are the same commands CI runs (see
`CONTRIBUTING.md`). Tick each one you actually ran.

- [ ] `cd web-panel && node test_harness.mjs` → `PASS panel smoke suite`
- [ ] `for f in $(git ls-files 'web-panel/*.js' 'web-panel/*.mjs' 'web-panel/*.cjs'); do node --check "$f"; done` → no output
- [ ] `python3 -m py_compile web-panel/scripts/*.py` → no output
- [ ] `tools/compile-plugins.sh` → `compiled: N failed: 3 allowed-failures: 3` (the three allowlisted sources are expected to fail; anything else is not)
- [ ] Not applicable for this change (explain why below)

<details>
<summary>Command output (paste the last few lines)</summary>

```
```

</details>

## Live-server risk

<!-- What could this do to the running server if it is wrong? Be specific:
     a plugin that can crash HLDS on a map change, a panel route that can sign
     with a stale secret, a migration that touches the live D1/SQLite replica,
     a config change that needs an `amx_rehashadmins` afterwards. Write "none —
     docs only" if that is the truth. -->

## Rollback

<!-- How to undo this if it goes wrong on the live host: revert this commit
     (and which one), restore which file from which backup, re-run which SQL.
     "Revert the PR" is only acceptable when there is nothing stateful. -->

## Notes on REVIEW.md / DEBUG.md

- [ ] This change does not touch anything `REVIEW.md` or `DEBUG.md` describes.
- [ ] It does, and I updated the text **and** put the command behind each claim
      in this PR (a claim with no command to reproduce it is a guess — see
      `CONTRIBUTING.md`).
- [ ] A plugin behaviour change: it has its own commit and a `REVIEW.md` entry.

## Secrets

- [ ] No credential, token, HMAC secret, webhook URL or password was added to
      the tree, to a test fixture, or to a log pasted above. Development values
      come from the environment, never from a file (`SECRETS.md`).
