FROM node:20-slim

# Install system dependencies for Playwright, Xvfb, PulseAudio, and FFmpeg
RUN apt-get update && apt-get install -y \
    xvfb \
    pulseaudio \
    pulseaudio-utils \
    ffmpeg \
    libnss3 \
    libatk-bridge2.0-0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpangocairo-1.0-0 \
    libxshmfence1 \
    procps \
    libegl1-mesa \
    libgl1-mesa-glx \
    libglapi-mesa \
    libosmesa6 \
    && rm -rf /var/lib/apt/lists/*

# Ensure /tmp/.X11-unix exists with sticky bit 1777 permissions before switching to node user
RUN mkdir -p /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix

# The official Node image already has a pre-created non-root user named "node" (UID 1000).
# We just need to add this existing "node" user to the audio groups.
RUN usermod -aG audio,pulse-access node

WORKDIR /app

# Copy package configurations and install dependencies
COPY package*.json ./
RUN npm install

# Install all Playwright system dependencies for Chromium (must be run as root)
RUN npx playwright install-deps chromium

# Copy remaining files and set owner to the "node" user
COPY . .
RUN chown -R node:node /app

# Switch to the existing non-root "node" user
USER node

# Install Playwright Chromium browser *after* switching to the "node" user
RUN npx playwright install chromium

# Environment variables for Xvfb
ENV DISPLAY=:99

CMD ["/bin/bash", "entrypoint.sh"]
