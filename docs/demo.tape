# docs/demo.tape -- row-oriented vs columnar, same query, same machine.
#
#   brew install vhs
#   vhs docs/demo.tape      ->  docs/demo.gif
#
# Committed next to the GIF on purpose: a recording you can regenerate is an
# artefact, a recording you can't is a claim. Re-run it whenever the numbers
# move and the README can never quietly go stale.

Output docs/demo.gif

Set Shell  "bash"
Set FontSize    18
Set Width     1200
Set Height     700
Set Padding     24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 35ms

# ── setup: clear the screen without filming it ────────────────────────────
Hide
Type "clear" Enter
Sleep 500ms
Show

# ── the dataset ───────────────────────────────────────────────────────────
Type "# 4,032,180 competition results · 42 columns · 786 MB of CSV"
Enter
Sleep 1200ms

# ── row-oriented: one 528-byte struct per lifter ──────────────────────────
Type "# row-oriented: one 528-byte struct per row"
Enter
Sleep 800ms
Type "./build-release/apps/engine data/openpowerlifting-2026-09-12-64bfe49f.csv aos"
Enter
Sleep 6s

Type ""
Enter
Sleep 400ms

# ── columnar: one contiguous array per column ─────────────────────────────
Type "# columnar: one contiguous array per column"
Enter
Sleep 800ms
Type "./build-release/apps/engine data/openpowerlifting-2026-09-12-64bfe49f.csv soa"
Enter
Sleep 9s

# ── let the final frame breathe so the loop reads ─────────────────────────
Sleep 3500ms
