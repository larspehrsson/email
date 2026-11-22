#!/usr/bin/env bash
# Build Email.app on this Mac, signed with a Developer ID certificate of your own and
# notarized by Apple: a copy that opens on any Mac without warnings, and whose notifications
# and keychain access macOS allows. (The copies on GitHub's releases are built by CI; this is
# for one of your own. A copy built here doesn't update itself.)
#
#   scripts/build-mac.sh [--no-notarize] [--install] [--open]
#
#   --no-notarize   sign only (enough for this Mac)
#   --install       put it in ~/Applications (quitting the copy that's running)
#   --open          open it afterwards
#
# Settings, from the environment or from scripts/mac-signing.env (not committed):
#   MAC_SIGN_IDENTITY  the certificate, as `security find-identity -v -p codesigning` names it
#                      (default: the first "Developer ID Application" one in the keychain)
#   NOTARY_PROFILE     a notarytool keychain profile, made once with
#                      xcrun notarytool store-credentials <name> --apple-id <id> --team-id <team>
#   or NOTARY_APPLE_ID, NOTARY_PASSWORD (an app-specific password) and NOTARY_TEAM_ID
#
# Output: target/release/bundle/macos/Email.app, and Email-<version>-mac.zip beside it.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/target/release/bundle/macos/Email.app"

info() { printf '\033[1;34m==> %s\033[0m\n' "$*"; }
ok() { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
die() {
  printf '\033[1;31merror: %s\033[0m\n' "$*" >&2
  exit 1
}

NOTARIZE=1
INSTALL=0
OPEN=0
for arg in "$@"; do
  case "$arg" in
    --no-notarize) NOTARIZE=0 ;;
    --install) INSTALL=1 ;;
    --open) OPEN=1 ;;
    -h | --help)
      sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) die "unknown option: $arg (see --help)" ;;
  esac
done

[[ "$(uname)" == "Darwin" ]] || die "this builds the macOS app; run it on a Mac"

# Settings of your own, kept out of git.
if [[ -f "$ROOT/scripts/mac-signing.env" ]]; then
  # shellcheck disable=SC1091
  source "$ROOT/scripts/mac-signing.env"
fi

# Tools. rustup puts cargo in ~/.cargo/bin, which a shell doesn't always have on its PATH.
[[ -d "$HOME/.cargo/bin" ]] && export PATH="$HOME/.cargo/bin:$PATH"
command -v cargo >/dev/null || die "cargo not found: install Rust with rustup (https://rustup.rs)"
command -v npm >/dev/null || die "npm not found: install Node.js 24"
xcrun --find notarytool >/dev/null 2>&1 || die "notarytool not found: install Xcode's command line tools (xcode-select --install)"

# The certificate.
if [[ -z "${MAC_SIGN_IDENTITY:-}" ]]; then
  MAC_SIGN_IDENTITY="$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' | head -1)"
fi
[[ -n "$MAC_SIGN_IDENTITY" ]] || die "no Developer ID Application certificate in the keychain; set MAC_SIGN_IDENTITY"
security find-identity -v -p codesigning | grep -qF "\"$MAC_SIGN_IDENTITY\"" || die "certificate not in the keychain: $MAC_SIGN_IDENTITY"

# Notarizing needs credentials: checked before the build, not after it.
notary_auth=()
if [[ "$NOTARIZE" == 1 ]]; then
  if [[ -n "${NOTARY_PROFILE:-}" ]]; then
    notary_auth=(--keychain-profile "$NOTARY_PROFILE")
  elif [[ -n "${NOTARY_APPLE_ID:-}" && -n "${NOTARY_PASSWORD:-}" && -n "${NOTARY_TEAM_ID:-}" ]]; then
    notary_auth=(--apple-id "$NOTARY_APPLE_ID" --password "$NOTARY_PASSWORD" --team-id "$NOTARY_TEAM_ID")
  else
    die "to notarize, set NOTARY_PROFILE (or NOTARY_APPLE_ID, NOTARY_PASSWORD and NOTARY_TEAM_ID); or use --no-notarize"
  fi
fi

# ---- build and sign
info "Building, signed by: $MAC_SIGN_IDENTITY"
cd "$ROOT/app"
[[ -d node_modules ]] || npm ci
# Tauri signs the app (hardened runtime, timestamp). It would also notarize, given APPLE_*
# credentials; that's done below instead, so they're kept from it.
env -u APPLE_ID -u APPLE_PASSWORD -u APPLE_TEAM_ID -u APPLE_API_KEY -u APPLE_API_ISSUER -u APPLE_API_KEY_PATH \
  -u APPLE_CERTIFICATE -u APPLE_CERTIFICATE_PASSWORD \
  APPLE_SIGNING_IDENTITY="$MAC_SIGN_IDENTITY" npx tauri build --bundles app
[[ -d "$APP" ]] || die "the build left no app at $APP"

codesign --verify --deep --strict "$APP" || die "the signature doesn't verify"
VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist")"
ok "Email $VERSION, signed"

# ---- notarize and staple
WORK="$(mktemp -d "${TMPDIR:-/tmp}/email-build.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
if [[ "$NOTARIZE" == 1 ]]; then
  info "Sending to Apple to notarize (usually a few minutes)"
  ditto -c -k --keepParent "$APP" "$WORK/Email.zip"
  xcrun notarytool submit "$WORK/Email.zip" "${notary_auth[@]}" --wait --output-format json >"$WORK/notary.json" || true
  status="$(plutil -extract status raw -o - "$WORK/notary.json" 2>/dev/null || true)"
  id="$(plutil -extract id raw -o - "$WORK/notary.json" 2>/dev/null || true)"
  if [[ "$status" != "Accepted" ]]; then
    cat "$WORK/notary.json" >&2 || true
    [[ -n "$id" ]] && xcrun notarytool log "$id" "${notary_auth[@]}" >&2 || true
    die "notarization: ${status:-no answer}"
  fi
  xcrun stapler staple "$APP"
  xcrun stapler validate "$APP"
  ok "Notarized and stapled"
  spctl --assess --type execute --verbose "$APP" || die "Gatekeeper doesn't accept it"
fi

# ---- package
ZIP="$ROOT/target/release/bundle/macos/Email-$VERSION-mac.zip"
rm -f "$ZIP"
ditto -c -k --keepParent "$APP" "$ZIP"
ok "$ZIP"

# ---- install
if [[ "$INSTALL" == 1 ]]; then
  if pgrep -qf "$HOME/Applications/Email.app/Contents/MacOS/"; then
    info "Quitting the Email that's running"
    osascript -e 'quit app "Email"' >/dev/null 2>&1 || true
    for _ in $(seq 1 20); do
      pgrep -qf "$HOME/Applications/Email.app/Contents/MacOS/" || break
      sleep 0.5
    done
  fi
  mkdir -p "$HOME/Applications"
  rm -rf "$HOME/Applications/Email.app"
  ditto "$APP" "$HOME/Applications/Email.app"
  ok "Installed in ~/Applications"
  APP="$HOME/Applications/Email.app"
fi
[[ "$OPEN" == 1 ]] && open "$APP"
exit 0
