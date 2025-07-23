#!/bin/bash

# Orchestra Manager Launch Script
# Automatically handles Wayland compatibility issues

echo "🎼 Starting Orchestra Manager..."

# Check if running on Wayland
if [ "$XDG_SESSION_TYPE" = "wayland" ]; then
    echo "⚡ Detected Wayland session - using compatibility mode"
    WEBKIT_DISABLE_COMPOSITING_MODE=1 GDK_BACKEND=x11 npm run tauri dev
else
    echo "🚀 Starting in standard mode"
    npm run tauri dev
fi