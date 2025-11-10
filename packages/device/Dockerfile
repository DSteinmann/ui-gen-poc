# syntax=docker/dockerfile:1
FROM node:20-alpine

WORKDIR /app/packages/device

COPY packages/device/package*.json ./
RUN npm install

COPY packages/device/ ./

EXPOSE 3002 5173

ENV DEVICE_API_PORT=3002 \
    BIND_ADDRESS=0.0.0.0

CMD ["npm", "run", "dev"]
