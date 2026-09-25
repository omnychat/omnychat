.PHONY: proto proto-ts build build-ts run test test-ts docker docker-up docs docs-build clean

PROTOC ?= $(CURDIR)/.tools/protoc/bin/protoc
export PATH := $(shell go env GOPATH)/bin:$(CURDIR)/.tools/protoc/bin:$(PATH)

proto:
	@test -x "$(PROTOC)" || (echo "protoc not found; place at .tools/protoc/bin/protoc or set PROTOC="; exit 1)
	$(PROTOC) -I proto --go_out=. --go_opt=module=github.com/OluwapelumiG/omnichat proto/omnichat/v1/omnichat.proto

proto-ts:
	cd clients/typescript && npm run proto

build:
	mkdir -p bin
	go build -o bin/omnichat ./server/cmd/omnichat

build-ts:
	cd clients/typescript && npm run build

run: build
	OMNICHAT_JWT_SECRET=$${OMNICHAT_JWT_SECRET:-dev-secret-change-me} \
	OMNICHAT_DB_PATH=$${OMNICHAT_DB_PATH:-./data/omnichat.db} \
	./bin/omnichat

test:
	go test ./...

test-ts:
	cd clients/typescript && npm test

docker:
	docker build -t omnichat:dev .

docker-up:
	OMNICHAT_JWT_SECRET=$${OMNICHAT_JWT_SECRET:-dev-secret-change-me} docker compose up --build

docs:
	cd docs && npm install && npm run dev

docs-build:
	cd docs && npm install && npm run build

clean:
	rm -rf bin data docs/.vitepress/dist docs/.vitepress/cache clients/typescript/packages/*/dist
