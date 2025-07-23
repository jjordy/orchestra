#!/bin/bash

# Orchestra Manager Build Script
# Automatically handles Wayland compatibility and creates production builds

echo "🎼 Building Orchestra Manager..."

# Build the frontend first
echo "📦 Building frontend..."
npm run build

if [ $? -ne 0 ]; then
    echo "❌ Frontend build failed"
    exit 1
fi

echo "✅ Frontend build completed"

# Check if running on Wayland and build accordingly
if [ "$XDG_SESSION_TYPE" = "wayland" ]; then
    echo "⚡ Detected Wayland session - building with compatibility mode"
    WEBKIT_DISABLE_COMPOSITING_MODE=1 GDK_BACKEND=x11 npm run tauri:build
else
    echo "🚀 Building in standard mode"
    npm run tauri:build
fi

if [ $? -eq 0 ]; then
    echo "🎉 Build completed successfully!"
    echo "📁 Binary location: src-tauri/target/release/orchestra-manager"
    echo "📦 Bundle location: src-tauri/target/release/bundle/"
    ls -la src-tauri/target/release/orchestra-manager 2>/dev/null || echo "⚠️ Binary not found in expected location"
else
    echo "⚠️ Bundle build failed, trying binary-only build..."
    # Fallback to binary-only build
    if [ "$XDG_SESSION_TYPE" = "wayland" ]; then
        WEBKIT_DISABLE_COMPOSITING_MODE=1 GDK_BACKEND=x11 npm run tauri:build:binary
    else
        npm run tauri build --no-bundle
    fi
    
    if [ $? -eq 0 ]; then
        echo "🎉 Binary-only build completed successfully!"
        echo "📁 Binary location: src-tauri/target/release/orchestra-manager"
        ls -la src-tauri/target/release/orchestra-manager 2>/dev/null || echo "⚠️ Binary not found in expected location"
    else
        echo "❌ Build failed completely"
        exit 1
    fi
fi