# syntax=docker/dockerfile:1
FROM node:20-alpine

WORKDIR /app/packages/capability-system

COPY packages/capability-system/package*.json ./
RUN npm install --omit=dev

COPY packages/capability-system/ ./

EXPOSE 3003

ENV CAPABILITY_PORT=3003 \
    BIND_ADDRESS=0.0.0.0

CMD ["npm", "start"]
