FROM node:20-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --production --no-optional

COPY index.js ./
RUN mkdir -p sessions

ENV NODE_ENV=production

CMD ["node", "index.js"]
