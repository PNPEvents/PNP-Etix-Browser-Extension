#!/usr/bin/env bash
set -euo pipefail

# The scanner is downloaded only to a temporary directory, never the project.
# Digests are pinned from the official v8.30.1 release asset metadata.
mode="${1:-git}"
case "$mode" in git|dir) ;; *) echo 'Usage: bash scripts/scan-secrets.sh [git|dir]' >&2; exit 2 ;; esac
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64)
    archive=gitleaks_8.30.1_linux_x64.tar.gz
    digest=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb ;;
  Darwin-arm64)
    archive=gitleaks_8.30.1_darwin_arm64.tar.gz
    digest=b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5 ;;
  Darwin-x86_64)
    archive=gitleaks_8.30.1_darwin_x64.tar.gz
    digest=dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709 ;;
  *) echo 'Unsupported platform; install Gitleaks and run it with --redact manually.' >&2; exit 2 ;;
esac

scanner_dir=$(mktemp -d)
trap 'rm -rf "$scanner_dir"' EXIT
curl --fail --silent --show-error --location --retry 3 \
  "https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/$archive" \
  --output "$scanner_dir/$archive"
if command -v sha256sum >/dev/null 2>&1; then
  actual=$(sha256sum "$scanner_dir/$archive" | cut -d ' ' -f 1)
else
  actual=$(shasum -a 256 "$scanner_dir/$archive" | cut -d ' ' -f 1)
fi
if [ "$actual" != "$digest" ]; then
  echo 'Gitleaks download checksum mismatch; refusing to run it.' >&2
  exit 1
fi
tar -xzf "$scanner_dir/$archive" -C "$scanner_dir" gitleaks
if [ "$mode" = git ]; then
  "$scanner_dir/gitleaks" git --redact --no-banner --ignore-gitleaks-allow --log-opts=--all .
else
  "$scanner_dir/gitleaks" dir --redact --no-banner --ignore-gitleaks-allow .
fi
