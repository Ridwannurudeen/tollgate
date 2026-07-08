FROM node:22-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
RUN mkdir -p data

VOLUME ["/app/data"]

CMD ["npm", "run", "watch:access-log"]
