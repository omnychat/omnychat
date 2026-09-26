package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/omnychat/omnychat/server/internal/api"
	"github.com/omnychat/omnychat/server/internal/auth"
	"github.com/omnychat/omnychat/server/internal/bus"
	"github.com/omnychat/omnychat/server/internal/config"
	"github.com/omnychat/omnychat/server/internal/hub"
	"github.com/omnychat/omnychat/server/internal/metrics"
	"github.com/omnychat/omnychat/server/internal/protocol"
	"github.com/omnychat/omnychat/server/internal/store"
	"github.com/omnychat/omnychat/server/internal/webhook"
	"github.com/omnychat/omnychat/server/internal/ws"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})))
	log := slog.Default()

	cfg, err := config.FromEnv()
	if err != nil {
		log.Error("config", "err", err)
		os.Exit(1)
	}

	st, err := store.Open(cfg.DBPath)
	if err != nil {
		log.Error("store", "err", err)
		os.Exit(1)
	}
	defer st.Close()

	verifier, err := auth.New(cfg.JWTSecret, cfg.JWTPublicKeyPEM, cfg.JWTIssuer)
	if err != nil {
		log.Error("auth", "err", err)
		os.Exit(1)
	}

	instanceID := cfg.InstanceID
	if instanceID == "" {
		instanceID = uuid.NewString()
	}

	h := hub.New(hub.WithLogger(log))

	var redisBus *bus.RedisBus
	if cfg.RedisURL != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		rb, err := bus.NewRedis(ctx, cfg.RedisURL, instanceID, h.DeliverRemote, log)
		cancel()
		if err != nil {
			log.Error("redis bus", "err", err)
			os.Exit(1)
		}
		redisBus = rb
		h.SetBus(rb)
		defer func() { _ = redisBus.Close() }()
	}

	var wh *webhook.Dispatcher
	if cfg.WebhookURL != "" {
		wh = &webhook.Dispatcher{
			URL:    cfg.WebhookURL,
			Secret: cfg.WebhookSecret,
			Log:    log,
			OnOK:   func() { metrics.WebhookOK.Inc() },
			OnFail: func() { metrics.WebhookFail.Inc() },
		}
	}

	handler := &protocol.Handler{Auth: verifier, Hub: h, Store: st, Webhooks: wh, Log: log}
	wsServer := &ws.Server{
		Hub:            h,
		Handler:        handler,
		AllowedOrigins: cfg.AllowedOrigins,
		MaxFrameBytes:  cfg.MaxFrameBytes,
		WriteTimeout:   time.Duration(cfg.WriteTimeoutSec) * time.Second,
		PingInterval:   time.Duration(cfg.PingIntervalSec) * time.Second,
	}
	apiServer := &api.Server{
		Store: st,
		Auth:  verifier,
		ReadyFn: func(ctx context.Context) error {
			if redisBus == nil {
				return nil
			}
			return redisBus.Ping(ctx)
		},
	}

	mux := http.NewServeMux()
	apiServer.Routes(mux)
	mux.Handle("/v1/ws", wsServer)
	mux.Handle("/metrics", metrics.Handler())

	httpServer := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Info("omnychat listening",
			"addr", cfg.HTTPAddr,
			"db", cfg.DBPath,
			"redis", cfg.RedisURL != "",
			"webhook", cfg.WebhookURL != "",
			"tls", cfg.TLSCertFile != "",
			"instance", instanceID,
		)
		var err error
		if cfg.TLSCertFile != "" {
			err = httpServer.ListenAndServeTLS(cfg.TLSCertFile, cfg.TLSKeyFile)
		} else {
			err = httpServer.ListenAndServe()
		}
		if err != nil && err != http.ErrServerClosed {
			log.Error("http", "err", err)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	log.Info("shutting down")
	_ = httpServer.Close()
}
