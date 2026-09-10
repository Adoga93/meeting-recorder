#!/bin/bash

# 1. Start Xvfb (Virtual Framebuffer Screen) on Display :99
echo "🖥️ Starting Virtual Display (Xvfb)..."
Xvfb :99 -screen 0 1280x720x24 -ac +extension GLX +render -noreset &
sleep 2

# 2. Start PulseAudio server in user mode (runs perfectly as our non-root botuser)
echo "🔊 Starting PulseAudio Server..."
pulseaudio -D --exit-idle-time=-1 --disallow-exit --realtime=no --log-target=stderr
sleep 2

# 3. Create virtual speaker (Null Sink) for meeting playback
echo "🎙️ Configuring Virtual Sound devices..."
pactl load-module module-null-sink sink_name=Virtual_Speaker sink_properties=device.description="Virtual_Speaker"
pactl set-default-sink Virtual_Speaker

# Create a separate isolated silent sink for the microphone (prevents feedback loop and beeping)
pactl load-module module-null-sink sink_name=Silent_Mic_Sink sink_properties=device.description="Silent_Mic_Sink"
pactl load-module module-virtual-source source_name=Virtual_Mic master=Silent_Mic_Sink.monitor
pactl set-source-mute Virtual_Mic 1
sleep 1

# 4. Start the recording bot
echo "🤖 Booting up Playwright Bot..."
npm start
