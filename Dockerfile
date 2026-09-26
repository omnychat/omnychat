# syntax=docker/dockerfile:1

FROM golang:1.22-alpine AS build
WORKDIR /src
RUN apk add --no-cache git ca-certificates
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /out/omnychat ./server/cmd/omnychat

FROM alpine:3.20
RUN apk add --no-cache ca-certificates wget
WORKDIR /app
COPY --from=build /out/omnychat /usr/local/bin/omnychat
ENV OMNYCHAT_HTTP_ADDR=:8080 \
    OMNYCHAT_DB_PATH=/data/omnychat.db
VOLUME ["/data"]
EXPOSE 8080
ENTRYPOINT ["omnychat"]
