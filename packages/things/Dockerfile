# syntax=docker/dockerfile:1
FROM node:22-alpine

WORKDIR /app/packages/things

COPY packages/things/package*.json ./
RUN npm install --omit=dev

COPY packages/things/ ./

EXPOSE 3006

ENV THINGS_PORT=3006 \
    BIND_ADDRESS=0.0.0.0

CMD ["npm", "start"]
