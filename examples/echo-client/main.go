package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/omnychat/omnychat/pkg/pb"
	"google.golang.org/protobuf/proto"
)

func main() {
	var (
		addr      = flag.String("addr", "http://localhost:8080", "gateway base URL")
		wsURL     = flag.String("ws", "ws://localhost:8080/v1/ws", "websocket URL")
		secret    = flag.String("secret", envOr("OMNYCHAT_JWT_SECRET", "dev-secret-change-me"), "JWT HMAC secret")
		sub       = flag.String("sub", "alice", "JWT subject")
		room      = flag.String("room", "lobby", "room id")
		body      = flag.String("body", "hello from echo-client", "message body")
		tokenOnly = flag.Bool("token-only", false, "print JWT and exit")
		create    = flag.Bool("create-room", true, "create room via REST if missing")
	)
	flag.Parse()

	token, err := mintToken(*secret, *sub)
	if err != nil {
		log.Fatal(err)
	}
	if *tokenOnly {
		fmt.Println(token)
		return
	}

	if *create {
		if err := ensureRoom(*addr, *room, token); err != nil {
			log.Printf("create room: %v (continuing)", err)
		}
	}

	conn, _, err := websocket.DefaultDialer.Dial(*wsURL, nil)
	if err != nil {
		log.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	reqID := uint64(1)
	mustWrite(conn, &pb.Envelope{
		RequestId: reqID,
		Payload:   &pb.Envelope_Auth{Auth: &pb.Auth{Token: token}},
	})
	env := mustRead(conn)
	if env.GetAuthOk() == nil {
		log.Fatalf("expected AuthOK, got %v", env.Payload)
	}
	fmt.Printf("authed as %s\n", env.GetAuthOk().GetUserId())

	reqID++
	mustWrite(conn, &pb.Envelope{
		RequestId: reqID,
		Payload:   &pb.Envelope_JoinRoom{JoinRoom: &pb.JoinRoom{RoomId: *room}},
	})
	env = mustRead(conn)
	if env.GetJoinOk() == nil {
		log.Fatalf("expected JoinOK, got %v", env.Payload)
	}
	fmt.Printf("joined %s latest_seq=%d\n", *room, env.GetJoinOk().GetLatestSeq())

	clientMsgID := uuid.NewString()
	reqID++
	mustWrite(conn, &pb.Envelope{
		RequestId: reqID,
		Payload: &pb.Envelope_SendMessage{SendMessage: &pb.SendMessage{
			RoomId:      *room,
			ClientMsgId: clientMsgID,
			Body:        *body,
		}},
	})

	deadline := time.Now().Add(5 * time.Second)
	var gotAck, gotEvent bool
	for time.Now().Before(deadline) && !(gotAck && gotEvent) {
		_ = conn.SetReadDeadline(time.Now().Add(time.Second))
		env = mustRead(conn)
		switch {
		case env.GetMessageAck() != nil:
			ack := env.GetMessageAck()
			fmt.Printf("ack server_msg_id=%s seq=%d\n", ack.GetServerMsgId(), ack.GetSeq())
			gotAck = true
		case env.GetMessageEvent() != nil:
			ev := env.GetMessageEvent()
			fmt.Printf("event from=%s seq=%d body=%q\n", ev.GetSenderId(), ev.GetSeq(), ev.GetBody())
			gotEvent = true
		case env.GetError() != nil:
			log.Fatalf("error: %s %s", env.GetError().GetCode(), env.GetError().GetMessage())
		default:
			fmt.Printf("other: %T\n", env.Payload)
		}
	}
	if !gotAck {
		log.Fatal("timeout waiting for MessageAck")
	}
	fmt.Println("ok")
}

func mintToken(secret, sub string) (string, error) {
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": sub,
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	return tok.SignedString([]byte(secret))
}

func ensureRoom(addr, roomID, token string) error {
	payload, _ := json.Marshal(map[string]string{"id": roomID, "name": roomID})
	req, err := http.NewRequest(http.MethodPost, addr+"/v1/rooms", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusConflict {
		return fmt.Errorf("status %d: %s", resp.StatusCode, body)
	}
	return nil
}

func mustWrite(conn *websocket.Conn, env *pb.Envelope) {
	raw, err := proto.Marshal(env)
	if err != nil {
		log.Fatal(err)
	}
	if err := conn.WriteMessage(websocket.BinaryMessage, raw); err != nil {
		log.Fatal(err)
	}
}

func mustRead(conn *websocket.Conn) *pb.Envelope {
	_, data, err := conn.ReadMessage()
	if err != nil {
		log.Fatal(err)
	}
	var env pb.Envelope
	if err := proto.Unmarshal(data, &env); err != nil {
		log.Fatal(err)
	}
	return &env
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
