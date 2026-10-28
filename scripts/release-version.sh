#!/bin/sh
# The suite's release versions, as tags and images name them: 27.1 for a
# series, 27.1.3 for its patches, 27.1-rc.1 for a release candidate. The
# console carries the same helper; the server's tools/release/version.py is
# the same rule in its Cargo form.
#
#   release-version.sh tags VERSION        image tags, one per line: a release
#                                          moves VERSION, its series and latest;
#                                          a release candidate VERSION and
#                                          <series>-rc, never latest
#   release-version.sh prerelease VERSION  exit 0 for a release candidate
#
# Anything else, including the old dated versions, is refused (exit 2).
# POSIX sh: it runs in the docker:cli image, which has no bash.
set -eu

usage() { sed -n '7,13p' "$0" >&2; exit 2; }
[ $# -eq 2 ] || usage
cmd=$1 v=$2

echo "$v" | grep -Eq '^[1-9][0-9]\.([1-9]|1[0-2])(\.[1-9][0-9]*|-rc\.[1-9][0-9]*)?$' \
  || { echo "$v is not YY.M, YY.M.N or YY.M-rc.N" >&2; exit 2; }
series=$(echo "$v" | sed -E 's/^([0-9]+\.[0-9]+).*/\1/')
case $v in *-rc.*) rc=1 ;; *) rc=0 ;; esac

case $cmd in
  tags)
    if [ $rc = 1 ]; then printf '%s\n%s-rc\n' "$v" "$series"
    elif [ "$v" = "$series" ]; then printf '%s\nlatest\n' "$v"
    else printf '%s\n%s\nlatest\n' "$v" "$series"
    fi ;;
  prerelease) [ $rc = 1 ] ;;
  *) usage ;;
esac
