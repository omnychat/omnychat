.PHONY: proto proto-ts build build-ts run test test-ts docker docker-up docs docs-build clean

PROTOC ?= $(CURDIR)/.tools/protoc/bin/protoc
export PATH := $(shell go env GOPATH)/bin:$(CURDIR)/.tools/protoc/bin:$(PATH)

proto:
	@test -x "$(PROTOC)" || (echo "protoc not found; place at .tools/protoc/bin/protoc or set PROTOC="; exit 1)
	$(PROTOC) -I proto --go_out=. --go_opt=module=github.com/omnychat/omnychat proto/omnychat/v1/omnychat.proto

proto-ts:
	cd clients/typescript && npm run proto

build:
	mkdir -p bin
	go build -o bin/omnychat ./server/cmd/omnychat

build-ts:
	cd clients/typescript && npm run build

run: build
	OMNYCHAT_JWT_SECRET=$${OMNYCHAT_JWT_SECRET:-dev-secret-change-me} \
	OMNYCHAT_DB_PATH=$${OMNYCHAT_DB_PATH:-./data/omnychat.db} \
	./bin/omnychat

test:
	go test ./...

test-ts:
	cd clients/typescript && npm test

docker:
	docker build -t omnychat:dev .

docker-up:
	OMNYCHAT_JWT_SECRET=$${OMNYCHAT_JWT_SECRET:-dev-secret-change-me} docker compose up --build

docs:
	cd docs && npm install && npm run dev

docs-build:
	cd docs && npm install && npm run build

clean:
	rm -rf bin data docs/.vitepress/dist docs/.vitepress/cache clients/typescript/packages/*/dist
