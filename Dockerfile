FROM node:20-slim

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --ignore-scripts
RUN npx --yes node-pre-gyp rebuild 2>/dev/null || true

COPY index.js ./

CMD ["node", "index.js"]
