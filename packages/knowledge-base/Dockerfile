# syntax=docker/dockerfile:1
FROM node:20-alpine

WORKDIR /app/packages/knowledge-base

COPY packages/knowledge-base/package*.json ./
RUN npm install --omit=dev

COPY packages/knowledge-base/ ./
COPY packages/core-system/output.schema.json ../core-system/output.schema.json

EXPOSE 3005

ENV KNOWLEDGE_BASE_PORT=3005 \
    BIND_ADDRESS=0.0.0.0

CMD ["npm", "start"]
