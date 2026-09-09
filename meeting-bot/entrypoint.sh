#!/bin/bash

# 1. Start Xvfb (Virtual Framebuffer Screen) on Display :99
echo "🖥️ Starting Virtual Display (Xvfb)..."
Xvfb :99 -screen 0 1280x720x24 -ac +extension GLX +render -noreset &
sleep 2

# 2. Start PulseAudio server in user mode (runs perfectly as our non-root botuser)
echo "🔊 Starting PulseAudio Server..."
pulseaudio -D --exit-idle-time=-1 --disallow-exit --realtime=no --log-target=stderr
sleep 2

# 3. Create virtual speaker (Null Sink) and capture loopback
echo "🎙️ Configuring Virtual Sound devices..."
pactl load-module module-null-sink sink_name=Virtual_Speaker sink_properties=device.description="Virtual_Speaker"
pactl set-default-sink Virtual_Speaker
pactl load-module module-virtual-source source_name=Virtual_Mic master=Virtual_Speaker.monitor
sleep 1

# 4. Start the recording bot
echo "🤖 Booting up Playwright Bot..."
npm start
