# Build stage
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
COPY server/package.json ./server/package.json
COPY client/package.json ./client/package.json
RUN npm install
COPY . .
RUN npm run build

# Runtime stage
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
ENV PLAYERS_FILE=/app/server/data/players.json
RUN mkdir -p /app/server/data
VOLUME ["/app/server/data"]
COPY --from=build /app ./
EXPOSE 3001
CMD ["node", "server/src/index.js"]
