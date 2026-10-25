#!/bin/sh
# Builds the dock-invisible WKWebView player and its overlay panel.
# Command Line Tools are enough; Xcode is not required.
set -e
dir=$(dirname "$0")
exec swiftc -O "$dir/overlay.swift" "$dir/wkplayer.swift" -o "$dir/wkplayer"
