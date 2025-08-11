#!/bin/bash
set -euo pipefail

# Create necessary directories
mkdir -p /tmp/audio-processing
chmod 777 /tmp/audio-processing

# Install FFmpeg and dependencies on Render
if [ -n "$RENDER" ]; then
  echo "Installing audio processing tools on Render..."
  apt-get update -qq
  
  # Install required packages
  apt-get install -y --no-install-recommends \
    ffmpeg \
    libmp3lame0 \
    libopus0 \
    libvorbisenc2 \
    libfdk-aac2 \
    sox \
    libsox-fmt-mp3
  
  # Verify installations
  echo "Verifying installed versions:"
  ffmpeg -version | head -n 1
  ffprobe -version | head -n 1
  sox --version

  # Clean up to reduce image size
  apt-get clean
  rm -rf /var/lib/apt/lists/*
fi

# Create symbolic links for consistent paths
ln -sf $(which ffmpeg) /usr/local/bin/ffmpeg
ln -sf $(which ffprobe) /usr/local/bin/ffprobe
ln -sf $(which sox) /usr/local/bin/sox

# Verify all tools are available
echo "Final tool verification:"
command -v ffmpeg
command -v ffprobe
command -v sox

echo "Audio processing environment ready"
