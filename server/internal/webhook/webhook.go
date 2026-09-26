package webhook

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"
)

type Event struct {
	Type        string `json:"type"`
	RoomID      string `json:"room_id"`
	ServerMsgID string `json:"server_msg_id"`
	SenderID    string `json:"sender_id"`
	Seq         uint64 `json:"seq"`
	UpdateSeq   uint64 `json:"update_seq"`
	Body        string `json:"body,omitempty"`
	At          int64  `json:"at"`
}

type Dispatcher struct {
	URL    string
	Secret string
	Client *http.Client
	Log    *slog.Logger
	OnOK   func()
	OnFail func()
}

func (d *Dispatcher) Emit(ev Event) {
	if d == nil || d.URL == "" {
		return
	}
	go d.sendWithRetry(ev)
}

func (d *Dispatcher) sendWithRetry(ev Event) {
	log := d.Log
	if log == nil {
		log = slog.Default()
	}
	client := d.Client
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}
	body, err := json.Marshal(ev)
	if err != nil {
		log.Error("webhook marshal", "err", err)
		return
	}
	sig := sign(d.Secret, body)
	delays := []time.Duration{0, 500 * time.Millisecond, 2 * time.Second}
	for i, delay := range delays {
		if delay > 0 {
			time.Sleep(delay)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, d.URL, bytes.NewReader(body))
		if err != nil {
			cancel()
			log.Error("webhook request", "err", err)
			if d.OnFail != nil {
				d.OnFail()
			}
			return
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-OmnyChat-Signature", "sha256="+sig)
		req.Header.Set("User-Agent", "omnychat-webhook/1")
		res, err := client.Do(req)
		cancel()
		if err == nil && res.StatusCode >= 200 && res.StatusCode < 300 {
			_ = res.Body.Close()
			if d.OnOK != nil {
				d.OnOK()
			}
			return
		}
		if res != nil {
			_ = res.Body.Close()
		}
		log.Warn("webhook attempt failed", "attempt", i+1, "err", err, "status", statusOf(res))
	}
	if d.OnFail != nil {
		d.OnFail()
	}
}

func statusOf(res *http.Response) int {
	if res == nil {
		return 0
	}
	return res.StatusCode
}

func sign(secret string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}

// VerifySignature checks X-OmnyChat-Signature against the raw body.
func VerifySignature(secret, header string, body []byte) bool {
	const prefix = "sha256="
	if len(header) < len(prefix) || header[:len(prefix)] != prefix {
		return false
	}
	want, err := hex.DecodeString(header[len(prefix):])
	if err != nil {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(body)
	return hmac.Equal(mac.Sum(nil), want)
}
