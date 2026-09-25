# syntax=docker/dockerfile:1

FROM golang:1.22-alpine AS build
WORKDIR /src
RUN apk add --no-cache git ca-certificates
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /out/omnichat ./server/cmd/omnichat

FROM alpine:3.20
RUN apk add --no-cache ca-certificates wget
WORKDIR /app
COPY --from=build /out/omnichat /usr/local/bin/omnichat
ENV OMNICHAT_HTTP_ADDR=:8080 \
    OMNICHAT_DB_PATH=/data/omnichat.db
VOLUME ["/data"]
EXPOSE 8080
ENTRYPOINT ["omnichat"]
