#!/bin/bash

# Exit on error
set -e

echo "🔑 Injecting secrets from .env..."
# Lit .env (gitignoré) et génère Sources/Secrets/AppSecrets.swift.
# Échoue si TWITCH_CLIENT_ID est vide — voir .env.example.
scripts/generate_secrets.sh

echo "⚙️  Generating project with xcodegen..."
xcodegen

echo "🔨 Building the app..."
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild clean build \
    -scheme NoSubVod \
    -configuration Release \
    -sdk iphoneos \
    CODE_SIGN_IDENTITY="" \
    CODE_SIGNING_REQUIRED=NO \
    CODE_SIGNING_ALLOWED=NO \
    CONFIGURATION_BUILD_DIR="$(pwd)/build/Release-iphoneos"

echo "📦 Packaging the IPA..."
# Make sure we're clean
rm -rf build/Payload build/NoSubVod.ipa

# Create the Payload folder inside build
mkdir -p build/Payload

# Copy the .app into Payload
cp -r build/Release-iphoneos/NoSubVod.app build/Payload/

# Zip the Payload folder to create the .ipa
cd build
zip -q -r NoSubVod.ipa Payload/

# Clean up
rm -rf Payload
cd ..

echo "✅ Build complete! The IPA is located at: build/NoSubVod.ipa"
