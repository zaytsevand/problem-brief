#!/usr/bin/env sh
# Install the problem-brief skill on Linux or macOS.
#
#   ./install.sh                 copy into ~/.claude/skills/problem-brief
#   ./install.sh --link          symlink instead, so a git pull updates the skill
#   ./install.sh --dir DIR       install into a different skills directory
#   ./install.sh --hook          also add the hooks: restore briefs after a summary, summarise each publish
#   ./install.sh --claude-md     also add one line to ~/.claude/CLAUDE.md: a brief is the default channel
#   ./install.sh --uninstall     remove it again (and the hook)
#
# POSIX sh on purpose: no bashisms, so it runs under dash, ash and zsh too.

set -eu

SRC=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
NAME=problem-brief
MODE=copy
HOOK=0
CLAUDE_MD=0
DEST=""

while [ $# -gt 0 ]; do
  case "$1" in
    --link)      MODE=link ;;
    --uninstall) MODE=uninstall ;;
    --hook)      HOOK=1 ;;
    --claude-md) CLAUDE_MD=1 ;;
    --dir)       shift; DEST=${1:-} ;;
    -h|--help)   sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)           echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

# Claude Code reads ~/.claude/skills; several other agents also read ~/.agents/skills.
if [ -z "$DEST" ]; then
  if [ -d "$HOME/.claude" ] || [ ! -d "$HOME/.agents" ]; then
    DEST="$HOME/.claude/skills"
  else
    DEST="$HOME/.agents/skills"
  fi
fi
TARGET="$DEST/$NAME"

OS=$(uname -s 2>/dev/null || echo unknown)
case "$OS" in
  Darwin) PLATFORM=macOS ;;
  Linux)  PLATFORM=Linux ;;
  *)      PLATFORM="$OS" ;;
esac

say()  { printf '%s\n' "$*"; }
warn() { printf '\033[33m!\033[0m %s\n' "$*" >&2; }
ok()   { printf '\033[32m✓\033[0m %s\n' "$*"; }

if [ "$MODE" = uninstall ]; then
  if [ -f "$TARGET/bin/install-hook.mjs" ] && command -v node >/dev/null 2>&1; then
    node "$TARGET/bin/install-hook.mjs" --remove >/dev/null && ok "removed the hooks, if they were there"
    node "$TARGET/bin/install-claude-md.mjs" --remove >/dev/null && ok "removed the CLAUDE.md line, if it was there"
  fi
  if [ -e "$TARGET" ] || [ -L "$TARGET" ]; then
    rm -rf "$TARGET"; ok "removed $TARGET"
  else
    say "nothing installed at $TARGET"
  fi
  exit 0
fi

# ── requirements ───────────────────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  warn "node is not on PATH. The renderer needs Node 18 or newer: https://nodejs.org"
else
  MAJOR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
  [ "$MAJOR" -ge 18 ] 2>/dev/null || warn "node $(node -v) is older than v18; the renderer may not run"
fi

say "Installing problem-brief for $PLATFORM into $DEST"
mkdir -p "$DEST"
[ -e "$TARGET" ] || [ -L "$TARGET" ] && rm -rf "$TARGET"

if [ "$MODE" = link ]; then
  ln -s "$SRC" "$TARGET"
  ok "linked $TARGET -> $SRC"
else
  mkdir -p "$TARGET"
  for item in SKILL.md bin schema examples; do
    [ -e "$SRC/$item" ] && cp -R "$SRC/$item" "$TARGET/"
  done
  ok "installed $TARGET"
fi

# ── the two skills this one composes ───────────────────────────────────────
missing=0
if [ -f "$DEST/archify/SKILL.md" ]; then
  ok "archify found — real drawings available"
else
  warn "archify not found. Drawings fall back to mermaid only."
  say  "    git clone https://github.com/tt-a1i/archify $DEST/archify"
  missing=1
fi

if ls "$HOME"/.claude/plugins/cache/humanizer >/dev/null 2>&1 \
   || [ -f "$DEST/humanizer/SKILL.md" ]; then
  ok "humanizer found — prose gets a pass before publishing"
else
  warn "humanizer not found. Briefs will read as machine-written."
  say  "    in Claude Code:  /plugin marketplace add blader/humanizer"
  say  "                     /plugin install humanizer@humanizer"
  missing=1
fi

# ── the hook that keeps rulings in view ────────────────────────────────────
if [ "$HOOK" -eq 1 ]; then
  node "$TARGET/bin/install-hook.mjs" && ok "briefs come back into view at every session start and after every summary"
else
  say  "  Optional: ./install.sh --hook adds two hooks: one puts each brief's rulings back"
  say  "  after a session is summarised, one computes the chat summary on every publish."
fi

# ── the line in CLAUDE.md ─────────────────────────────────────────────────
if [ "$CLAUDE_MD" -eq 1 ]; then
  node "$TARGET/bin/install-claude-md.mjs" && ok "every session is told a brief is the default channel, hooks or not"
fi

say ""
ok "problem-brief is installed."
say "Try it:  node \"$TARGET/bin/render-brief.mjs\" \"$TARGET/examples/example.brief.json\" ./brief.html"
[ "$missing" -eq 1 ] && say "Install the missing pieces above for the full thing."
exit 0
