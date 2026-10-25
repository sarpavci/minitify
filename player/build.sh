#!/bin/sh
# Builds the dock-invisible WKWebView player. Command Line Tools are enough;
# Xcode is not required.
set -e
dir=$(dirname "$0")
exec swiftc -O "$dir/wkplayer.swift" -o "$dir/wkplayer"
