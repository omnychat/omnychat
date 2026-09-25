package metrics

import (
	"net/http"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

var (
	WSConnections = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "omnichat_ws_connections",
		Help: "Active WebSocket connections",
	})
	MessagesSent = promauto.NewCounter(prometheus.CounterOpts{
		Name: "omnichat_messages_sent_total",
		Help: "Messages created via SendMessage",
	})
	MessagesEdited = promauto.NewCounter(prometheus.CounterOpts{
		Name: "omnichat_messages_edited_total",
		Help: "Messages edited",
	})
	MessagesDeleted = promauto.NewCounter(prometheus.CounterOpts{
		Name: "omnichat_messages_deleted_total",
		Help: "Messages deleted",
	})
	WebhookOK = promauto.NewCounter(prometheus.CounterOpts{
		Name: "omnichat_webhook_success_total",
		Help: "Successful webhook deliveries",
	})
	WebhookFail = promauto.NewCounter(prometheus.CounterOpts{
		Name: "omnichat_webhook_fail_total",
		Help: "Failed webhook deliveries",
	})
	RedisPublishErrors = promauto.NewCounter(prometheus.CounterOpts{
		Name: "omnichat_redis_publish_errors_total",
		Help: "Redis publish failures",
	})
)

func Handler() http.Handler {
	return promhttp.Handler()
}
