# docs/serve.tape -- load once, serve fast. The architecture in 20 seconds.
#
#   vhs docs/serve.tape     ->  docs/serve.gif
#
# Run from the REPO ROOT. Every path below is relative to the working
# directory, not to this file.
#
# Needs: the full CSV in data/, grpcurl installed, port 50051 free.
# Everything on screen is real output -- nothing is narrated.

Output docs/serve.gif

Set Shell  "bash"
Set FontSize    17
Set Width     1180
Set Height     700
Set Padding     24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 30ms

# ── clean prompt, off camera ──────────────────────────────────────────────
Hide
Type "export PS1='$ '" Enter
Type "clear" Enter
Sleep 500ms
Show

# ── start the server in the background; its real stderr lands on screen ───
Type "# 4,032,180 rows. Parse once at startup, then serve."
Enter
Sleep 1s

Type "./build-release/apps/engine_server data/openpowerlifting-*.csv &"
Enter
Sleep 7s

Type "clear"
Enter
Sleep 300ms

# ── the question ──────────────────────────────────────────────────────────
Type "# where does a 140 kg bench rank among lifters who squat 210?"
Enter
Sleep 1200ms

Type "cat docs/query.json"
Enter
Sleep 2500ms

Type "grpcurl -plaintext -import-path proto -proto engine.proto -d @ \"
Enter
Type "  localhost:50051 engine.v1.Engine/ConditionalPercentile < docs/query.json"
Enter
Sleep 3s

Type "# n is returned with every percentile: over 5 people it is not wrong,"
Enter
Type "# it is meaningless -- and only n tells you which one you are reading."
Enter
Sleep 3500ms

# ── tidy up, off camera ───────────────────────────────────────────────────
Hide
Type "kill %1" Enter
Sleep 500ms
