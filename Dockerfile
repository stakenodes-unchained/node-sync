FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Initialize chains on first run
RUN node init-chains.js

EXPOSE 3000

CMD ["node", "server.js"]
