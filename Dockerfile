FROM node:20

WORKDIR /app

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --production --legacy-peer-deps --no-audit

COPY index.js ./
RUN mkdir -p sessions

ENV NODE_ENV=production

CMD ["node", "index.js"]
