# syntax=docker/dockerfile:1
FROM node:20-alpine

WORKDIR /app/packages/tablet-device

COPY packages/tablet-device/package*.json ./
RUN npm install

COPY packages/tablet-device/ ./

EXPOSE 3012 5174

ENV DEVICE_API_PORT=3012 \
    BIND_ADDRESS=0.0.0.0

CMD ["npm", "run", "dev"]
