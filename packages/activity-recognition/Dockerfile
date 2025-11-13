# syntax=docker/dockerfile:1
FROM node:22-alpine

WORKDIR /app/packages/activity-recognition

COPY packages/activity-recognition/package*.json ./
RUN npm install --omit=dev

COPY packages/activity-recognition/ ./

EXPOSE 3003

ENV ACTIVITY_RECOGNITION_PORT=3003 \
    BIND_ADDRESS=0.0.0.0

CMD ["npm", "start"]
