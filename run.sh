#!/bin/sh
# Run the experiment server on a shared lab server behind a reverse proxy.
#
#   screen -S game
#   chmod u+x run.sh && ./run.sh
#   detach with ctrl-a d, come back with: screen -r game
#
# The two values below are assigned by the lab -- ask before the first run:
#   PORT       the loopback port reserved for this app
#   BASE_PATH  the path segment we are served under, matching the public URL
#
# The app then answers at https://<your-host>$BASE_PATH/index.html

PORT="${PORT:-41520}"
BASE_PATH="${BASE_PATH:-/CHANGEME}"
HOST="${HOST:-127.0.0.1}"     # the proxy reaches us on loopback; nothing else should

# Needed to download data through the browser once deployed, since the export
# endpoints refuse anonymous requests when BASE_PATH is set. Pick any long
# random string. Leave it unset and just use server/export.js over ssh instead.
# EXPORT_TOKEN="change-me-to-something-random"
[ -n "$EXPORT_TOKEN" ] && export EXPORT_TOKEN

# The completion code from the Prolific study (Study settings > Completion paths >
# "Completed"). Participants who finish are sent back with it. A new Prolific
# study has a new code, so pass it on the command line rather than editing code:
#   PROLIFIC_COMPLETION_CODE=ABC123 ./run.sh
[ -n "$PROLIFIC_COMPLETION_CODE" ] && export PROLIFIC_COMPLETION_CODE

export PORT BASE_PATH HOST

case "$BASE_PATH" in
    /CHANGEME) echo "Set BASE_PATH in run.sh to your assigned path segment first." >&2; exit 1 ;;
esac

# If the server's system node is too old, point NODE at a private build
# instead of touching the shared account's PATH or shell config:
#
#   NODE=$HOME/<you>/node-v22.20.0-linux-x64/bin/node ./run.sh
#
NODE="${NODE:-node}"

# server/db.js uses node:sqlite, which needs Node 22.5+. Check here so a stale
# Node fails with a clear message instead of a stack trace on the first round a
# participant finishes.
major=$("$NODE" -p 'process.versions.node.split(".")[0]' 2>/dev/null)
minor=$("$NODE" -p 'process.versions.node.split(".")[1]' 2>/dev/null)
if [ -z "$major" ]; then
    echo "Cannot run '$NODE' -- set NODE to a Node 22.5+ binary." >&2
    exit 1
fi
if [ "$major" -lt 22 ] || { [ "$major" -eq 22 ] && [ "$minor" -lt 5 ]; }; then
    echo "Node $("$NODE" --version) is too old -- server/db.js needs >= 22.5.0" >&2
    echo "Set NODE to a newer binary, e.g." >&2
    echo "  NODE=\$HOME/<you>/node-v22.20.0-linux-x64/bin/node ./run.sh" >&2
    exit 1
fi

"$NODE" server/app.js
echo "finished"
