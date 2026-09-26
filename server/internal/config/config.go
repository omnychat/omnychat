package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	HTTPAddr        string
	DBPath          string
	JWTSecret       string
	JWTPublicKeyPEM string
	JWTIssuer       string
	AllowedOrigins  []string
	MaxFrameBytes   int64
	WriteTimeoutSec int
	PingIntervalSec int

	RedisURL string
	InstanceID string

	WebhookURL    string
	WebhookSecret string

	TLSCertFile string
	TLSKeyFile  string
}

func FromEnv() (Config, error) {
	cfg := Config{
		HTTPAddr:        getenv("OMNYCHAT_HTTP_ADDR", ":8080"),
		DBPath:          getenv("OMNYCHAT_DB_PATH", "./data/omnychat.db"),
		JWTSecret:       os.Getenv("OMNYCHAT_JWT_SECRET"),
		JWTPublicKeyPEM: os.Getenv("OMNYCHAT_JWT_PUBLIC_KEY"),
		JWTIssuer:       os.Getenv("OMNYCHAT_JWT_ISSUER"),
		AllowedOrigins:  splitCSV(getenv("OMNYCHAT_ALLOWED_ORIGINS", "*")),
		MaxFrameBytes:   int64(getenvInt("OMNYCHAT_MAX_FRAME_BYTES", 1<<20)),
		WriteTimeoutSec: getenvInt("OMNYCHAT_WRITE_TIMEOUT_SEC", 10),
		PingIntervalSec: getenvInt("OMNYCHAT_PING_INTERVAL_SEC", 30),
		RedisURL:        os.Getenv("OMNYCHAT_REDIS_URL"),
		InstanceID:      getenv("OMNYCHAT_INSTANCE_ID", ""),
		WebhookURL:      os.Getenv("OMNYCHAT_WEBHOOK_URL"),
		WebhookSecret:   os.Getenv("OMNYCHAT_WEBHOOK_SECRET"),
		TLSCertFile:     os.Getenv("OMNYCHAT_TLS_CERT_FILE"),
		TLSKeyFile:      os.Getenv("OMNYCHAT_TLS_KEY_FILE"),
	}
	if cfg.JWTSecret == "" && cfg.JWTPublicKeyPEM == "" {
		return cfg, fmt.Errorf("set OMNYCHAT_JWT_SECRET or OMNYCHAT_JWT_PUBLIC_KEY")
	}
	if (cfg.TLSCertFile == "") != (cfg.TLSKeyFile == "") {
		return cfg, fmt.Errorf("set both OMNYCHAT_TLS_CERT_FILE and OMNYCHAT_TLS_KEY_FILE, or neither")
	}
	if cfg.WebhookURL != "" && cfg.WebhookSecret == "" {
		return cfg, fmt.Errorf("OMNYCHAT_WEBHOOK_SECRET required when OMNYCHAT_WEBHOOK_URL is set")
	}
	return cfg, nil
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func getenvInt(k string, def int) int {
	v := os.Getenv(k)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}

func splitCSV(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}
