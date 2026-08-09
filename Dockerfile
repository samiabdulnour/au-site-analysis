# Autonomous Site Analyst — web interface.
#   docker build -t site-analyst .
#   docker run -p 3000:3000 -e ACCESS_CODE=… -e TFNSW_API_KEY=… site-analyst
FROM node:22-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-liberation python3 python3-pip \
 && pip3 install --break-system-packages --no-cache-dir ezdxf pyproj \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY web ./web
COPY config ./config
COPY assets ./assets

ARG GIT_SHA=dev
ENV CHROMIUM_PATH=/usr/bin/chromium \
    CHROMIUM_NO_SANDBOX=1 \
    PORT=3000 \
    GIT_SHA=$GIT_SHA

EXPOSE 3000
CMD ["npx", "tsx", "src/server.ts"]
