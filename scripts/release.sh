#!/bin/bash
# Bumps the version, then publishes main as a GitHub release. Run with:
#   bash scripts/release.sh
#
# Refuses unless you're on main with a clean tree that matches origin/main,
# package.json's version is the latest published release, and the full e2e
# suite (`npm test`) passed within the last hour. It asks for the new version,
# runs the unit tests, then commits "Cut vX.Y.Z" (package.json and its lock) and
# pushes it to main. If a later step fails, rerunning with that commit still at
# HEAD resumes releasing it instead of asking again. Everything is built and
# checked before you're asked to confirm; gh then creates the tag on GitHub at
# the bump commit, with notes linking to the commits since the last release.
set -euo pipefail
cd "$(dirname "$0")/.."

die() { echo "!! $*" >&2; exit 1; }
is_semver() { echo "$1" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; }

[ $# -eq 0 ] || die "takes no arguments; you're asked for the version"

echo "==> preflight"
command -v gh >/dev/null       || die "gh is not installed:  brew install gh"
gh auth status >/dev/null 2>&1 || die "gh is not logged in:  gh auth login"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$BRANCH" = "main" ] || die "on branch '$BRANCH'; releases are cut from main"
[ -z "$(git status --porcelain)" ] || die "uncommitted changes; commit or discard them first"
git fetch --quiet origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] \
  || die "main and origin/main differ; push (or pull) first"

CURRENT="$(node -p "require('./package.json').version")"
LATEST="$(gh release view --json tagName -q .tagName)" || die "couldn't read the latest published release"
LATEST="${LATEST#v}"
if [ "$(git log -1 --format=%s)" = "Cut v$CURRENT" ] && [ "$CURRENT" != "$LATEST" ]; then
  VERSION="$CURRENT"
  echo "    resuming the unpublished v$VERSION bump at HEAD (latest release is v$LATEST)"
else
  [ "$CURRENT" = "$LATEST" ] \
    || die "package.json is $CURRENT but the latest release is v$LATEST; fix package.json first"
  read -r -p "Current version is $CURRENT. New version: " VERSION
  is_semver "$VERSION" || die "'$VERSION' must look like 1.2.3"
  node -e '
    const [a, b] = process.argv.slice(1).map(v => v.split(".").map(Number));
    const cmp = a.map((n, i) => n - b[i]).find(d => d !== 0) ?? 0;
    process.exit(cmp > 0 ? 0 : 1);
  ' "$VERSION" "$CURRENT" || die "$VERSION is not newer than $CURRENT"
fi
TAG="v$VERSION"
DMG="release/Ludi-$VERSION-arm64.dmg"
[ -z "$(git ls-remote --tags origin "refs/tags/$TAG")" ] || die "$TAG is already released"

# The stamp is written by tests/e2e/pass-stamp-reporter.js on every passing run;
# comparing its count against --list rejects a filtered run.
echo "==> checking the last e2e run"
[ -f .last-test-pass.json ] || die "no passing e2e run on record; run npm test"
PASSED_AT="$(node -p "require('./.last-test-pass.json').passedAt")"
PASSED_COUNT="$(node -p "require('./.last-test-pass.json').testCount")"
AGE_MIN=$(( ($(date +%s) - PASSED_AT) / 60 ))
[ "$AGE_MIN" -lt 60 ] || die "e2e suite last passed ${AGE_MIN} minutes ago; run npm test (must be within the hour)"
TOTAL_COUNT="$(npx playwright test --list | sed -nE 's/^Total: ([0-9]+) tests? in .*/\1/p')"
[ -n "$TOTAL_COUNT" ] || die "could not read the test total from playwright test --list"
[ "$PASSED_COUNT" = "$TOTAL_COUNT" ] \
  || die "last passing run covered $PASSED_COUNT of $TOTAL_COUNT tests; run the full npm test"

echo "==> unit tests"
npx vitest run

if [ "$VERSION" != "$CURRENT" ]; then
  echo "==> bumping to $VERSION"
  npm version "$VERSION" --no-git-tag-version >/dev/null
  git commit --quiet -m "Cut $TAG" -- package.json package-lock.json
  git push --quiet origin main || die "push failed; the 'Cut $TAG' commit is local only. Push it and rerun to resume"
fi
COMMIT="$(git rev-parse HEAD)"

echo "==> building"
rm -f "$DMG"
npm run release
[ -f "$DMG" ] || die "build finished but $DMG is missing"

# The suite run above tested whatever build existed then (or skipped this spec);
# this checks the bundle actually being shipped.
echo "==> testing the packaged app"
npx playwright test tests/e2e/packaged-app.spec.js

REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
NOTES="Changes since v$LATEST: https://github.com/$REPO/compare/v$LATEST...$TAG"

cat <<SUMMARY

------------------------------------------------------------
Ready to publish $TAG
  commit   ${COMMIT:0:10} ($(git log -1 --format=%s))
  repo     $REPO
  asset    $DMG ($(du -h "$DMG" | cut -f1))
  e2e      $PASSED_COUNT tests passed ${AGE_MIN} minutes ago
  notes    $NOTES
------------------------------------------------------------
SUMMARY

read -r -p "Publish? [y/N] " reply
[ "$reply" = "y" ] || [ "$reply" = "Y" ] || die "aborted; nothing was published. Rerun to resume releasing $TAG"

gh release create "$TAG" "$DMG" --target "$COMMIT" --title "$TAG" --notes "$NOTES"
git fetch --quiet --tags origin

echo
echo "Published: $(gh release view "$TAG" --json url -q .url)"
