# syntax=docker/dockerfile:1
FROM node:22-alpine

WORKDIR /app/packages/voice-device

COPY packages/voice-device/package*.json ./
RUN npm install --omit=dev

COPY packages/voice-device/ ./

EXPOSE 3004

ENV VOICE_DEVICE_PORT=3004 \
    BIND_ADDRESS=0.0.0.0

CMD ["npm", "start"]
