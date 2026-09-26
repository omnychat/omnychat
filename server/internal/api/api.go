package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/omnychat/omnychat/server/internal/auth"
	"github.com/omnychat/omnychat/server/internal/store"
)

type Server struct {
	Store   *store.Store
	Auth    *auth.Verifier
	ReadyFn func(context.Context) error
}

func (s *Server) Routes(mux *http.ServeMux) {
	mux.HandleFunc("/healthz", s.healthz)
	mux.HandleFunc("/readyz", s.readyz)
	mux.HandleFunc("/v1/rooms", s.rooms)
}

func (s *Server) healthz(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok"))
}

func (s *Server) readyz(w http.ResponseWriter, r *http.Request) {
	if err := s.Store.Ping(); err != nil {
		http.Error(w, "not ready", http.StatusServiceUnavailable)
		return
	}
	if s.ReadyFn != nil {
		if err := s.ReadyFn(r.Context()); err != nil {
			http.Error(w, "not ready", http.StatusServiceUnavailable)
			return
		}
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok"))
}

type createRoomReq struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type createRoomResp struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	CreatedAtUnixMs int64  `json:"created_at_unix_ms"`
}

func (s *Server) rooms(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if _, err := s.bearerUser(r); err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	var req createRoomReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	req.ID = strings.TrimSpace(req.ID)
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		http.Error(w, "name required", http.StatusBadRequest)
		return
	}
	if req.ID == "" {
		req.ID = uuid.NewString()
	}
	room, err := s.Store.CreateRoom(req.ID, req.Name)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			http.Error(w, "room already exists", http.StatusConflict)
			return
		}
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(createRoomResp{
		ID:              room.ID,
		Name:            room.Name,
		CreatedAtUnixMs: room.CreatedAtUnixMs,
	})
}

func (s *Server) bearerUser(r *http.Request) (string, error) {
	h := r.Header.Get("Authorization")
	const prefix = "Bearer "
	if !strings.HasPrefix(h, prefix) {
		return "", errUnauthorized
	}
	return s.Auth.Verify(strings.TrimSpace(h[len(prefix):]))
}

var errUnauthorized = errString("unauthorized")

type errString string

func (e errString) Error() string { return string(e) }
