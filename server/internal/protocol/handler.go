package protocol

import (
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/OluwapelumiG/omnichat/pkg/pb"
	"github.com/OluwapelumiG/omnichat/server/internal/auth"
	"github.com/OluwapelumiG/omnichat/server/internal/hub"
	"github.com/OluwapelumiG/omnichat/server/internal/metrics"
	"github.com/OluwapelumiG/omnichat/server/internal/store"
	"github.com/OluwapelumiG/omnichat/server/internal/webhook"
	"google.golang.org/protobuf/proto"
)

type Conn interface {
	hub.Conn
	Authenticated() bool
	SetUserID(userID string)
	Close()
}

type Handler struct {
	Auth     *auth.Verifier
	Hub      *hub.Hub
	Store    *store.Store
	Webhooks *webhook.Dispatcher
	Log      *slog.Logger
}

func (h *Handler) log() *slog.Logger {
	if h.Log != nil {
		return h.Log
	}
	return slog.Default()
}

func (h *Handler) Handle(c Conn, raw []byte) {
	var env pb.Envelope
	if err := proto.Unmarshal(raw, &env); err != nil {
		h.replyError(c, 0, "invalid", "malformed envelope")
		return
	}
	reqID := env.GetRequestId()

	if !c.Authenticated() {
		authMsg := env.GetAuth()
		if authMsg == nil {
			h.replyError(c, reqID, "unauthorized", "authenticate first")
			c.Close()
			return
		}
		h.handleAuth(c, reqID, authMsg)
		return
	}

	switch p := env.Payload.(type) {
	case *pb.Envelope_Auth:
		h.replyError(c, reqID, "invalid", "already authenticated")
	case *pb.Envelope_JoinRoom:
		h.handleJoin(c, reqID, p.JoinRoom)
	case *pb.Envelope_LeaveRoom:
		h.handleLeave(c, reqID, p.LeaveRoom)
	case *pb.Envelope_SendMessage:
		h.handleSend(c, reqID, p.SendMessage)
	case *pb.Envelope_Typing:
		h.handleTyping(c, p.Typing)
	case *pb.Envelope_ReadReceipt:
		h.handleReceipt(c, reqID, p.ReadReceipt)
	case *pb.Envelope_SyncRoom:
		h.handleSync(c, reqID, p.SyncRoom)
	case *pb.Envelope_EditMessage:
		h.handleEdit(c, reqID, p.EditMessage)
	case *pb.Envelope_DeleteMessage:
		h.handleDelete(c, reqID, p.DeleteMessage)
	default:
		h.replyError(c, reqID, "invalid", "unsupported payload")
	}
}

func (h *Handler) handleAuth(c Conn, reqID uint64, msg *pb.Auth) {
	userID, err := h.Auth.Verify(msg.GetToken())
	if err != nil {
		h.replyError(c, reqID, "unauthorized", "invalid token")
		c.Close()
		return
	}
	c.SetUserID(userID)
	h.Hub.Register(c)
	h.send(c, &pb.Envelope{
		RequestId: reqID,
		Payload: &pb.Envelope_AuthOk{AuthOk: &pb.AuthOK{
			UserId:           userID,
			ServerTimeUnixMs: time.Now().UnixMilli(),
		}},
	})
}

func (h *Handler) handleJoin(c Conn, reqID uint64, msg *pb.JoinRoom) {
	roomID := strings.TrimSpace(msg.GetRoomId())
	if roomID == "" {
		h.replyError(c, reqID, "invalid", "room_id required")
		return
	}
	if _, err := h.Store.GetRoom(roomID); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			h.replyError(c, reqID, "not_found", "room not found")
			return
		}
		h.log().Error("get room", "err", err)
		h.replyError(c, reqID, "internal", "store error")
		return
	}
	if err := h.Store.EnsureMember(roomID, c.UserID()); err != nil {
		h.log().Error("ensure member", "err", err)
		h.replyError(c, reqID, "internal", "store error")
		return
	}
	latest, err := h.Store.LatestSeq(roomID)
	if err != nil {
		h.log().Error("latest seq", "err", err)
		h.replyError(c, reqID, "internal", "store error")
		return
	}
	h.Hub.Join(c, roomID)
	h.send(c, &pb.Envelope{
		RequestId: reqID,
		Payload: &pb.Envelope_JoinOk{JoinOk: &pb.JoinOK{
			RoomId:    roomID,
			LatestSeq: latest,
		}},
	})
}

func (h *Handler) handleLeave(c Conn, reqID uint64, msg *pb.LeaveRoom) {
	roomID := strings.TrimSpace(msg.GetRoomId())
	if roomID == "" {
		h.replyError(c, reqID, "invalid", "room_id required")
		return
	}
	h.Hub.Leave(c, roomID)
	h.send(c, &pb.Envelope{
		RequestId: reqID,
		Payload:   &pb.Envelope_LeaveOk{LeaveOk: &pb.LeaveOK{RoomId: roomID}},
	})
}

func (h *Handler) handleSend(c Conn, reqID uint64, msg *pb.SendMessage) {
	roomID := strings.TrimSpace(msg.GetRoomId())
	clientMsgID := strings.TrimSpace(msg.GetClientMsgId())
	body := msg.GetBody()
	if roomID == "" || clientMsgID == "" {
		h.replyError(c, reqID, "invalid", "room_id and client_msg_id required")
		return
	}
	if strings.TrimSpace(body) == "" {
		h.replyError(c, reqID, "invalid", "body required")
		return
	}
	if !h.Hub.InRoom(c, roomID) {
		h.replyError(c, reqID, "forbidden", "join room first")
		return
	}
	m, err := h.Store.InsertMessage(roomID, c.UserID(), clientMsgID, body)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			h.replyError(c, reqID, "not_found", "room not found")
			return
		}
		h.log().Error("insert message", "err", err)
		h.replyError(c, reqID, "internal", "store error")
		return
	}

	metrics.MessagesSent.Inc()
	h.send(c, &pb.Envelope{
		RequestId: reqID,
		Payload: &pb.Envelope_MessageAck{MessageAck: &pb.MessageAck{
			RoomId:          m.RoomID,
			ClientMsgId:     m.ClientMsgID,
			ServerMsgId:     m.ServerMsgID,
			Seq:             m.Seq,
			CreatedAtUnixMs: m.CreatedAtUnixMs,
		}},
	})
	h.broadcastMessage(m)
	h.emitWebhook("message.created", m)
}

func (h *Handler) handleEdit(c Conn, reqID uint64, msg *pb.EditMessage) {
	roomID := strings.TrimSpace(msg.GetRoomId())
	serverMsgID := strings.TrimSpace(msg.GetServerMsgId())
	body := msg.GetBody()
	if roomID == "" || serverMsgID == "" {
		h.replyError(c, reqID, "invalid", "room_id and server_msg_id required")
		return
	}
	if strings.TrimSpace(body) == "" {
		h.replyError(c, reqID, "invalid", "body required")
		return
	}
	if !h.Hub.InRoom(c, roomID) {
		h.replyError(c, reqID, "forbidden", "join room first")
		return
	}
	m, err := h.Store.EditMessage(roomID, serverMsgID, c.UserID(), body)
	if err != nil {
		h.mapMutationErr(c, reqID, err)
		return
	}
	metrics.MessagesEdited.Inc()
	h.send(c, &pb.Envelope{RequestId: reqID, Payload: &pb.Envelope_MessageAck{MessageAck: &pb.MessageAck{
		RoomId:          m.RoomID,
		ClientMsgId:     m.ClientMsgID,
		ServerMsgId:     m.ServerMsgID,
		Seq:             m.Seq,
		CreatedAtUnixMs: m.CreatedAtUnixMs,
	}}})
	h.broadcastMessage(m)
	h.emitWebhook("message.edited", m)
}

func (h *Handler) handleDelete(c Conn, reqID uint64, msg *pb.DeleteMessage) {
	roomID := strings.TrimSpace(msg.GetRoomId())
	serverMsgID := strings.TrimSpace(msg.GetServerMsgId())
	if roomID == "" || serverMsgID == "" {
		h.replyError(c, reqID, "invalid", "room_id and server_msg_id required")
		return
	}
	if !h.Hub.InRoom(c, roomID) {
		h.replyError(c, reqID, "forbidden", "join room first")
		return
	}
	m, err := h.Store.DeleteMessage(roomID, serverMsgID, c.UserID())
	if err != nil {
		h.mapMutationErr(c, reqID, err)
		return
	}
	metrics.MessagesDeleted.Inc()
	h.send(c, &pb.Envelope{RequestId: reqID, Payload: &pb.Envelope_MessageAck{MessageAck: &pb.MessageAck{
		RoomId:          m.RoomID,
		ClientMsgId:     m.ClientMsgID,
		ServerMsgId:     m.ServerMsgID,
		Seq:             m.Seq,
		CreatedAtUnixMs: m.CreatedAtUnixMs,
	}}})
	h.broadcastMessage(m)
	h.emitWebhook("message.deleted", m)
}

func (h *Handler) mapMutationErr(c Conn, reqID uint64, err error) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		h.replyError(c, reqID, "not_found", "message not found")
	case errors.Is(err, store.ErrForbidden):
		h.replyError(c, reqID, "forbidden", "not message author")
	case errors.Is(err, store.ErrGone):
		h.replyError(c, reqID, "gone", "message deleted")
	default:
		h.log().Error("mutate message", "err", err)
		h.replyError(c, reqID, "internal", "store error")
	}
}

func (h *Handler) messageEvent(m store.Message) *pb.MessageEvent {
	return &pb.MessageEvent{
		RoomId:          m.RoomID,
		ClientMsgId:     m.ClientMsgID,
		ServerMsgId:     m.ServerMsgID,
		SenderId:        m.SenderID,
		Body:            m.Body,
		Seq:             m.Seq,
		CreatedAtUnixMs: m.CreatedAtUnixMs,
		UpdateSeq:       m.UpdateSeq,
		EditedAtUnixMs:  m.EditedAtUnixMs,
		Deleted:         m.Deleted,
	}
}

func (h *Handler) broadcastMessage(m store.Message) {
	raw, err := proto.Marshal(&pb.Envelope{
		Payload: &pb.Envelope_MessageEvent{MessageEvent: h.messageEvent(m)},
	})
	if err != nil {
		h.log().Error("marshal event", "err", err)
		return
	}
	h.Hub.Broadcast(m.RoomID, raw)
}

func (h *Handler) emitWebhook(typ string, m store.Message) {
	if h.Webhooks == nil {
		return
	}
	h.Webhooks.Emit(webhook.Event{
		Type:        typ,
		RoomID:      m.RoomID,
		ServerMsgID: m.ServerMsgID,
		SenderID:    m.SenderID,
		Seq:         m.Seq,
		UpdateSeq:   m.UpdateSeq,
		Body:        m.Body,
		At:          time.Now().UnixMilli(),
	})
}

func (h *Handler) handleTyping(c Conn, msg *pb.Typing) {
	roomID := strings.TrimSpace(msg.GetRoomId())
	if roomID == "" || !h.Hub.InRoom(c, roomID) {
		return
	}
	raw, err := proto.Marshal(&pb.Envelope{
		Payload: &pb.Envelope_TypingEvent{TypingEvent: &pb.TypingEvent{
			RoomId:   roomID,
			UserId:   c.UserID(),
			IsTyping: msg.GetIsTyping(),
		}},
	})
	if err != nil {
		return
	}
	h.Hub.Broadcast(roomID, raw)
}

func (h *Handler) handleReceipt(c Conn, reqID uint64, msg *pb.ReadReceipt) {
	roomID := strings.TrimSpace(msg.GetRoomId())
	if roomID == "" {
		h.replyError(c, reqID, "invalid", "room_id required")
		return
	}
	if !h.Hub.InRoom(c, roomID) {
		h.replyError(c, reqID, "forbidden", "join room first")
		return
	}
	r, changed, err := h.Store.UpsertReceipt(roomID, c.UserID(), msg.GetLastReadSeq())
	if err != nil {
		h.log().Error("upsert receipt", "err", err)
		h.replyError(c, reqID, "internal", "store error")
		return
	}
	if !changed {
		return
	}
	raw, err := proto.Marshal(&pb.Envelope{
		Payload: &pb.Envelope_ReceiptEvent{ReceiptEvent: &pb.ReceiptEvent{
			RoomId:          r.RoomID,
			UserId:          r.UserID,
			LastReadSeq:     r.LastReadSeq,
			UpdatedAtUnixMs: r.UpdatedAtUnixMs,
		}},
	})
	if err != nil {
		return
	}
	h.Hub.Broadcast(roomID, raw)
}

func (h *Handler) handleSync(c Conn, reqID uint64, msg *pb.SyncRoom) {
	roomID := strings.TrimSpace(msg.GetRoomId())
	if roomID == "" {
		h.replyError(c, reqID, "invalid", "room_id required")
		return
	}
	if _, err := h.Store.GetRoom(roomID); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			h.replyError(c, reqID, "not_found", "room not found")
			return
		}
		h.replyError(c, reqID, "internal", "store error")
		return
	}
	limit := int(msg.GetLimit())
	if limit <= 0 {
		limit = 500
	}
	msgs, err := h.Store.MessagesSince(roomID, msg.GetSinceSeq(), limit)
	if err != nil {
		h.log().Error("sync", "err", err)
		h.replyError(c, reqID, "internal", "store error")
		return
	}
	for _, m := range msgs {
		h.send(c, &pb.Envelope{
			Payload: &pb.Envelope_MessageEvent{MessageEvent: h.messageEvent(m)},
		})
	}
	latest, err := h.Store.LatestSeq(roomID)
	if err != nil {
		h.replyError(c, reqID, "internal", "store error")
		return
	}
	hasMore := len(msgs) == limit
	if hasMore && len(msgs) > 0 {
		hasMore = msgs[len(msgs)-1].UpdateSeq < latest
	}
	h.send(c, &pb.Envelope{
		RequestId: reqID,
		Payload: &pb.Envelope_SyncComplete{SyncComplete: &pb.SyncComplete{
			RoomId:    roomID,
			LatestSeq: latest,
			HasMore:   hasMore,
		}},
	})
}

func (h *Handler) replyError(c Conn, reqID uint64, code, message string) {
	h.send(c, &pb.Envelope{
		RequestId: reqID,
		Payload: &pb.Envelope_Error{Error: &pb.Error{
			Code:    code,
			Message: message,
		}},
	})
}

func (h *Handler) send(c Conn, env *pb.Envelope) {
	raw, err := proto.Marshal(env)
	if err != nil {
		h.log().Error("marshal", "err", err)
		return
	}
	c.Send(raw)
}
