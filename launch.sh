#!/bin/bash

# Orchestra Manager Launch Script (Production)
# Launches the built application with proper Wayland compatibility

BINARY_PATH="src-tauri/target/release/orchestra-manager"

if [ ! -f "$BINARY_PATH" ]; then
    echo "❌ Binary not found at $BINARY_PATH"
    echo "Please run ./build.sh first to build the application"
    exit 1
fi

echo "🎼 Launching Orchestra Manager..."

# Check if running on Wayland
if [ "$XDG_SESSION_TYPE" = "wayland" ]; then
    echo "⚡ Detected Wayland session - using compatibility mode"
    WEBKIT_DISABLE_COMPOSITING_MODE=1 GDK_BACKEND=x11 ./$BINARY_PATH
else
    echo "🚀 Starting in standard mode"
    ./$BINARY_PATH
fi