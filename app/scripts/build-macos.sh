#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$(uname -s)" != Darwin ]]; then
  echo "Run this script on your Mac. Windows build is a separate artifact." >&2
  exit 1
fi
command -v node >/dev/null
command -v npm >/dev/null
case "$(uname -m)" in
  arm64) target_arch=arm64 ;;
  x86_64) target_arch=x64 ;;
  *) echo "Unsupported Mac architecture" >&2; exit 1 ;;
esac
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npx --no-install electron-builder --config electron-builder.mac.cjs --mac --"$target_arch" --publish never
echo "Built Meowcast in release/mac for $target_arch. Native acceptance and signature verification still required."
