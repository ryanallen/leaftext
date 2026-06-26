#!/usr/bin/env bash
# Build the Linux release asset for leaftext: a single tar.gz containing the
# release executable. Mirrors scripts/build-windows-release.ps1. The binary is
# not signed.
#
# Usage:
#   scripts/build-linux-release.sh [--tag vX.Y.Z] [--out dist] [--dry-run]
#
# If --tag is omitted it is read from .release-tag, and if that is missing it is
# derived from the version in Cargo.toml.
set -euo pipefail

tag=""
out="dist"
dry_run="false"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --tag) tag="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    --dry-run) dry_run="true"; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

version="$(sed -n 's/^version[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' Cargo.toml | head -n1)"
if [ -z "$version" ]; then
  echo "Could not find version in Cargo.toml" >&2
  exit 1
fi

if [ -z "$tag" ]; then
  if [ -f .release-tag ]; then
    tag="$(tr -d '[:space:]' < .release-tag)"
  else
    tag="v$version"
  fi
fi

# The tag without its leading v must equal the Cargo.toml version.
tag_version="${tag#v}"
if [ "$tag_version" != "$version" ]; then
  echo "Tag $tag does not match Cargo.toml version $version" >&2
  exit 1
fi

arch="x86_64"
dist="$repo_root/$out"
package_name="leaftext-$tag-linux-$arch"
exe_path="$repo_root/target/release/leaftext"
stage_dir="$dist/$package_name"
out_exe="$stage_dir/leaftext"
out_tar="$dist/$package_name.tar.gz"

echo "Repo:        $repo_root"
echo "Version:     $version"
echo "Tag:         $tag"
echo "Out folder:  $dist"
echo "Asset:       $(basename "$out_tar")"

if [ "$dry_run" = "true" ]; then
  echo "Dry run: nothing built."
  exit 0
fi

# 1. Build the release binary.
cargo build --release --locked --bins
test -x "$exe_path"

# 2. Stage the executable and publish a compressed archive for release.
rm -rf "$dist"
mkdir -p "$stage_dir"
cp "$exe_path" "$out_exe"
chmod +x "$out_exe"
tar -C "$dist" -czf "$out_tar" "$package_name"
test -f "$out_tar"

# 3. Verification: report version and list files. No secrets printed.
echo ""
echo "Built leaftext $version ($tag). Asset in $dist :"
ls -l "$dist"
