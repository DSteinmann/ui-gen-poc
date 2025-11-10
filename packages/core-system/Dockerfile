# syntax=docker/dockerfile:1
FROM node:20-alpine

WORKDIR /app

COPY packages/core-system/package*.json ./
RUN npm install --omit=dev

COPY packages/core-system/ ./

EXPOSE 3000 3001

ENV CORE_SYSTEM_PORT=3001 \
    SERVICE_REGISTRY_PORT=3000 \
    BIND_ADDRESS=0.0.0.0

CMD ["npm", "start"]
