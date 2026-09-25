package bus

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

const channel = "omnichat:broadcast"

// Publisher fans events out to other gateway instances.
type Publisher interface {
	Publish(roomID string, payload []byte) error
	Close() error
	Ping(ctx context.Context) error
}

// Subscriber delivers remote payloads to the local hub.
type DeliverFunc func(roomID string, payload []byte)

type envelope struct {
	InstanceID string `json:"instance_id"`
	RoomID     string `json:"room_id"`
	Payload    []byte `json:"payload"`
}

// Nop is a no-op bus for single-node mode.
type Nop struct{}

func (Nop) Publish(string, []byte) error             { return nil }
func (Nop) Close() error                             { return nil }
func (Nop) Ping(context.Context) error               { return nil }

// RedisBus publishes and subscribes via Redis pub/sub.
type RedisBus struct {
	client     *redis.Client
	instanceID string
	pubsub     *redis.PubSub
	cancel     context.CancelFunc
	wg         sync.WaitGroup
	log        *slog.Logger
}

func NewRedis(ctx context.Context, redisURL, instanceID string, deliver DeliverFunc, log *slog.Logger) (*RedisBus, error) {
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("parse redis url: %w", err)
	}
	client := redis.NewClient(opts)
	if err := client.Ping(ctx).Err(); err != nil {
		_ = client.Close()
		return nil, fmt.Errorf("redis ping: %w", err)
	}
	if instanceID == "" {
		instanceID = uuid.NewString()
	}
	if log == nil {
		log = slog.Default()
	}
	b := &RedisBus{
		client:     client,
		instanceID: instanceID,
		log:        log,
	}
	subCtx, cancel := context.WithCancel(context.Background())
	b.cancel = cancel
	b.pubsub = client.Subscribe(subCtx, channel)
	b.wg.Add(1)
	go b.loop(subCtx, deliver)
	return b, nil
}

func (b *RedisBus) InstanceID() string { return b.instanceID }

func (b *RedisBus) Publish(roomID string, payload []byte) error {
	raw, err := json.Marshal(envelope{
		InstanceID: b.instanceID,
		RoomID:     roomID,
		Payload:    payload,
	})
	if err != nil {
		return err
	}
	return b.client.Publish(context.Background(), channel, raw).Err()
}

func (b *RedisBus) Ping(ctx context.Context) error {
	return b.client.Ping(ctx).Err()
}

func (b *RedisBus) Close() error {
	if b.cancel != nil {
		b.cancel()
	}
	b.wg.Wait()
	if b.pubsub != nil {
		_ = b.pubsub.Close()
	}
	return b.client.Close()
}

func (b *RedisBus) loop(ctx context.Context, deliver DeliverFunc) {
	defer b.wg.Done()
	ch := b.pubsub.Channel()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			var env envelope
			if err := json.Unmarshal([]byte(msg.Payload), &env); err != nil {
				b.log.Warn("redis bus decode", "err", err)
				continue
			}
			if env.InstanceID == b.instanceID {
				continue
			}
			if deliver != nil {
				deliver(env.RoomID, env.Payload)
			}
		}
	}
}
