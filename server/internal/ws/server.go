package ws

import (
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/OluwapelumiG/omnichat/server/internal/hub"
	"github.com/OluwapelumiG/omnichat/pkg/pb"
	"github.com/OluwapelumiG/omnichat/server/internal/protocol"
	"google.golang.org/protobuf/proto"
)

type Server struct {
	Hub            *hub.Hub
	Handler        *protocol.Handler
	AllowedOrigins []string
	MaxFrameBytes  int64
	WriteTimeout   time.Duration
	PingInterval   time.Duration
}

type conn struct {
	id     string
	userID string
	auth   bool
	ws     *websocket.Conn
	sendCh chan []byte
	done   chan struct{}
	server *Server
	once   sync.Once
	mu     sync.Mutex
}

func (c *conn) ID() string     { return c.id }
func (c *conn) UserID() string { return c.userID }
func (c *conn) Authenticated() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.auth
}
func (c *conn) SetUserID(userID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.userID = userID
	c.auth = true
}

func (c *conn) Send(msg []byte) bool {
	select {
	case <-c.done:
		return false
	default:
	}
	select {
	case <-c.done:
		return false
	case c.sendCh <- msg:
		return true
	default:
		go c.Close()
		return false
	}
}

func (c *conn) Close() {
	c.once.Do(func() {
		close(c.done)
		c.mu.Lock()
		wasAuth := c.auth
		c.mu.Unlock()
		if wasAuth {
			c.server.Hub.Unregister(c)
		}
		_ = c.ws.Close()
	})
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	up := websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin: func(r *http.Request) bool {
			if len(s.AllowedOrigins) == 0 {
				return true
			}
			for _, o := range s.AllowedOrigins {
				if o == "*" || o == r.Header.Get("Origin") {
					return true
				}
			}
			return false
		},
	}
	wsConn, err := up.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("ws upgrade: %v", err)
		return
	}
	if s.MaxFrameBytes > 0 {
		wsConn.SetReadLimit(s.MaxFrameBytes)
	}

	c := &conn{
		id:     uuid.NewString(),
		ws:     wsConn,
		sendCh: make(chan []byte, 64),
		done:   make(chan struct{}),
		server: s,
	}

	go c.writePump()
	c.readPump()
}

func (c *conn) readPump() {
	defer c.Close()
	_ = c.ws.SetReadDeadline(time.Now().Add(c.server.PingInterval * 2))
	c.ws.SetPongHandler(func(string) error {
		return c.ws.SetReadDeadline(time.Now().Add(c.server.PingInterval * 2))
	})
	for {
		mt, data, err := c.ws.ReadMessage()
		if err != nil {
			return
		}
		if mt != websocket.BinaryMessage {
			raw, _ := proto.Marshal(&pb.Envelope{
				Payload: &pb.Envelope_Error{Error: &pb.Error{
					Code:    "invalid",
					Message: "binary frames only",
				}},
			})
			_ = c.ws.SetWriteDeadline(time.Now().Add(c.server.WriteTimeout))
			_ = c.ws.WriteMessage(websocket.BinaryMessage, raw)
			return
		}
		c.server.Handler.Handle(c, data)
	}
}

func (c *conn) writePump() {
	defer c.Close()
	ticker := time.NewTicker(c.server.PingInterval)
	defer ticker.Stop()
	for {
		select {
		case <-c.done:
			return
		case msg := <-c.sendCh:
			_ = c.ws.SetWriteDeadline(time.Now().Add(c.server.WriteTimeout))
			if err := c.ws.WriteMessage(websocket.BinaryMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			_ = c.ws.SetWriteDeadline(time.Now().Add(c.server.WriteTimeout))
			if err := c.ws.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
