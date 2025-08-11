#!/bin/bash
set -e

# Create necessary directories
mkdir -p ./temp ./logs

# Install FFmpeg on Render.com
if [ -n "$RENDER" ]; then
  echo "Installing FFmpeg on Render.com"
  apt-get update
  apt-get install -y ffmpeg
fi

# Verify installation and check version
if ! command -v ffmpeg &> /dev/null; then
  echo "FFmpeg could not be found"
  exit 1
fi

echo "FFmpeg version:"
ffmpeg -version
