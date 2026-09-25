package hub

import (
	"log/slog"
	"sync"

	"github.com/OluwapelumiG/omnichat/server/internal/bus"
	"github.com/OluwapelumiG/omnichat/server/internal/metrics"
)

// Conn is the subset of a WebSocket connection the hub needs.
type Conn interface {
	ID() string
	UserID() string
	Send(msg []byte) bool
}

type Hub struct {
	mu          sync.RWMutex
	conns       map[string]Conn
	userConns   map[string]map[string]Conn
	roomConns   map[string]map[string]Conn
	connRooms   map[string]map[string]struct{}
	bus         bus.Publisher
	log         *slog.Logger
}

func New(opts ...Option) *Hub {
	h := &Hub{
		conns:     make(map[string]Conn),
		userConns: make(map[string]map[string]Conn),
		roomConns: make(map[string]map[string]Conn),
		connRooms: make(map[string]map[string]struct{}),
		bus:       bus.Nop{},
		log:       slog.Default(),
	}
	for _, o := range opts {
		o(h)
	}
	return h
}

type Option func(*Hub)

func WithBus(p bus.Publisher) Option {
	return func(h *Hub) {
		if p != nil {
			h.bus = p
		}
	}
}

func WithLogger(log *slog.Logger) Option {
	return func(h *Hub) {
		if log != nil {
			h.log = log
		}
	}
}

// SetBus replaces the publishbackend (used after Redis subscribe is ready).
func (h *Hub) SetBus(p bus.Publisher) {
	if p == nil {
		p = bus.Nop{}
	}
	h.mu.Lock()
	h.bus = p
	h.mu.Unlock()
}

func (h *Hub) Register(c Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.conns[c.ID()] = c
	if h.userConns[c.UserID()] == nil {
		h.userConns[c.UserID()] = make(map[string]Conn)
	}
	h.userConns[c.UserID()][c.ID()] = c
	h.connRooms[c.ID()] = make(map[string]struct{})
	metrics.WSConnections.Set(float64(len(h.conns)))
}

func (h *Hub) Unregister(c Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.conns, c.ID())
	if m := h.userConns[c.UserID()]; m != nil {
		delete(m, c.ID())
		if len(m) == 0 {
			delete(h.userConns, c.UserID())
		}
	}
	for roomID := range h.connRooms[c.ID()] {
		if m := h.roomConns[roomID]; m != nil {
			delete(m, c.ID())
			if len(m) == 0 {
				delete(h.roomConns, roomID)
			}
		}
	}
	delete(h.connRooms, c.ID())
	metrics.WSConnections.Set(float64(len(h.conns)))
}

func (h *Hub) Join(c Conn, roomID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.roomConns[roomID] == nil {
		h.roomConns[roomID] = make(map[string]Conn)
	}
	h.roomConns[roomID][c.ID()] = c
	if h.connRooms[c.ID()] == nil {
		h.connRooms[c.ID()] = make(map[string]struct{})
	}
	h.connRooms[c.ID()][roomID] = struct{}{}
}

func (h *Hub) Leave(c Conn, roomID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if m := h.roomConns[roomID]; m != nil {
		delete(m, c.ID())
		if len(m) == 0 {
			delete(h.roomConns, roomID)
		}
	}
	if rooms := h.connRooms[c.ID()]; rooms != nil {
		delete(rooms, roomID)
	}
}

func (h *Hub) InRoom(c Conn, roomID string) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	rooms := h.connRooms[c.ID()]
	if rooms == nil {
		return false
	}
	_, ok := rooms[roomID]
	return ok
}

// Broadcast sends payload to local room subscribers and publishes to the bus.
func (h *Hub) Broadcast(roomID string, payload []byte) {
	h.broadcastLocal(roomID, payload)
	if err := h.bus.Publish(roomID, payload); err != nil {
		metrics.RedisPublishErrors.Inc()
		h.log.Warn("bus publish", "room", roomID, "err", err)
	}
}

// DeliverRemote fans in a payload from another instance (local only).
func (h *Hub) DeliverRemote(roomID string, payload []byte) {
	h.broadcastLocal(roomID, payload)
}

func (h *Hub) broadcastLocal(roomID string, payload []byte) {
	h.mu.RLock()
	conns := h.roomConns[roomID]
	snapshot := make([]Conn, 0, len(conns))
	for _, c := range conns {
		snapshot = append(snapshot, c)
	}
	h.mu.RUnlock()
	for _, c := range snapshot {
		c.Send(payload)
	}
}
