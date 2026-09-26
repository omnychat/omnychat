package gatewaytest_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/omnychat/omnychat/pkg/pb"
	"github.com/omnychat/omnychat/server/internal/api"
	"github.com/omnychat/omnychat/server/internal/auth"
	"github.com/omnychat/omnychat/server/internal/hub"
	"github.com/omnychat/omnychat/server/internal/protocol"
	"github.com/omnychat/omnychat/server/internal/store"
	"github.com/omnychat/omnychat/server/internal/ws"
	"google.golang.org/protobuf/proto"
)

func TestE2ESendReceive(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	secret := "test-secret"
	verifier, err := auth.New(secret, "", "")
	if err != nil {
		t.Fatal(err)
	}
	h := hub.New()
	handler := &protocol.Handler{Auth: verifier, Hub: h, Store: st}
	wsServer := &ws.Server{
		Hub:            h,
		Handler:        handler,
		AllowedOrigins: []string{"*"},
		MaxFrameBytes:  1 << 20,
		WriteTimeout:   2 * time.Second,
		PingInterval:   30 * time.Second,
	}
	apiServer := &api.Server{Store: st, Auth: verifier}
	mux := http.NewServeMux()
	apiServer.Routes(mux)
	mux.Handle("/v1/ws", wsServer)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	roomBody, _ := json.Marshal(map[string]string{"id": "lobby", "name": "Lobby"})
	req, err := http.NewRequest(http.MethodPost, srv.URL+"/v1/rooms", bytes.NewReader(roomBody))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+mint(t, secret, "service"))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create room status %d", resp.StatusCode)
	}

	alice := dialAuthed(t, srv.URL, secret, "alice", "lobby")
	defer alice.Close()
	bob := dialAuthed(t, srv.URL, secret, "bob", "lobby")
	defer bob.Close()

	clientMsgID := uuid.NewString()
	mustWrite(t, alice, &pb.Envelope{
		RequestId: 10,
		Payload: &pb.Envelope_SendMessage{SendMessage: &pb.SendMessage{
			RoomId:      "lobby",
			ClientMsgId: clientMsgID,
			Body:        "ping",
		}},
	})

	ack := waitFor(t, alice, 2*time.Second, func(e *pb.Envelope) bool { return e.GetMessageAck() != nil })
	if ack.GetMessageAck().GetClientMsgId() != clientMsgID {
		t.Fatalf("bad ack: %+v", ack.GetMessageAck())
	}
	ev := waitFor(t, bob, 2*time.Second, func(e *pb.Envelope) bool {
		return e.GetMessageEvent() != nil && e.GetMessageEvent().GetBody() == "ping"
	})
	if ev.GetMessageEvent().GetSenderId() != "alice" {
		t.Fatalf("expected alice, got %s", ev.GetMessageEvent().GetSenderId())
	}
}

func dialAuthed(t *testing.T, httpURL, secret, sub, room string) *websocket.Conn {
	t.Helper()
	wsURL := "ws" + httpURL[len("http"):] + "/v1/ws"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	tok := mint(t, secret, sub)
	mustWrite(t, conn, &pb.Envelope{
		RequestId: 1,
		Payload:   &pb.Envelope_Auth{Auth: &pb.Auth{Token: tok}},
	})
	env := mustRead(t, conn)
	if env.GetAuthOk() == nil {
		t.Fatalf("auth failed: %v", env.Payload)
	}
	mustWrite(t, conn, &pb.Envelope{
		RequestId: 2,
		Payload:   &pb.Envelope_JoinRoom{JoinRoom: &pb.JoinRoom{RoomId: room}},
	})
	env = mustRead(t, conn)
	if env.GetJoinOk() == nil {
		t.Fatalf("join failed: %v", env.Payload)
	}
	return conn
}

func mint(t *testing.T, secret, sub string) string {
	t.Helper()
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": sub,
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	s, err := tok.SignedString([]byte(secret))
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func mustWrite(t *testing.T, conn *websocket.Conn, env *pb.Envelope) {
	t.Helper()
	raw, err := proto.Marshal(env)
	if err != nil {
		t.Fatal(err)
	}
	if err := conn.WriteMessage(websocket.BinaryMessage, raw); err != nil {
		t.Fatal(err)
	}
}

func mustRead(t *testing.T, conn *websocket.Conn) *pb.Envelope {
	t.Helper()
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, data, err := conn.ReadMessage()
	if err != nil {
		t.Fatal(err)
	}
	var env pb.Envelope
	if err := proto.Unmarshal(data, &env); err != nil {
		t.Fatal(err)
	}
	return &env
}

func waitFor(t *testing.T, conn *websocket.Conn, d time.Duration, pred func(*pb.Envelope) bool) *pb.Envelope {
	t.Helper()
	deadline := time.Now().Add(d)
	for time.Now().Before(deadline) {
		_ = conn.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
		_, data, err := conn.ReadMessage()
		if err != nil {
			continue
		}
		var env pb.Envelope
		if err := proto.Unmarshal(data, &env); err != nil {
			t.Fatal(err)
		}
		if pred(&env) {
			return &env
		}
	}
	t.Fatal("timeout waiting for message")
	return nil
}
