FROM node:22-alpine AS builder

WORKDIR /app

# RUN apk add --no-cache curl unzip bash
RUN apk add --no-cache bash

# ENV LEO_VERSION=mainnet
# ENV LEO_URL=https://github.com/ProvableHQ/leo/releases/latest/download/leo-${LEO_VERSION}-x86_64-unknown-linux-musl.zip

# RUN curl -L $LEO_URL -o leo.zip && \
#     unzip leo.zip && \
#     chmod +x leo && \
#     rm -f leo.zip

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

COPY . .
RUN yarn build

FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache bash

COPY --from=builder /app ./
# COPY --from=builder /app/leo /usr/local/bin/leo

ENV NODE_ENV=production
ENV PATH=/app/node_modules/.bin:$PATH

EXPOSE 8080

CMD if [ "$MODE" = "dev" ]; then yarn dev; else yarn start; fi
