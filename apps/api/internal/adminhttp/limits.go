package adminhttp

import (
	"net/http"
	"strconv"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminaccess"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminsecurity"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/ratelimit"
)

// Initial v1 abuse limits from the security acceptance plan. Authenticated
// buckets are keyed by the verified admin user, which a caller cannot vary;
// session bootstrap and step-up failures are keyed by the verified Access
// identity. Each limiter is process-local, so the API must run one replica
// until a shared store replaces it.
const (
	adminReadLimit        = 120
	adminReadWindow       = time.Minute
	adminWriteLimit       = 30
	adminWriteWindow      = time.Minute
	adminCriticalLimit    = 10
	adminCriticalWindow   = 15 * time.Minute
	accessFailureLimit    = 5
	accessFailureWindow   = 15 * time.Minute
	rateLimitedReasonCode = "rate_limited"
)

type limiters struct {
	reads          *ratelimit.Limiter
	writes         *ratelimit.Limiter
	criticalWrites *ratelimit.Limiter
	accessFailures *ratelimit.Limiter
	logoUploads    *ratelimit.Limiter
}

func newLimiters(now func() time.Time) limiters {
	return limiters{
		reads:          ratelimit.NewWithClock(adminReadLimit, adminReadWindow, now),
		writes:         ratelimit.NewWithClock(adminWriteLimit, adminWriteWindow, now),
		criticalWrites: ratelimit.NewWithClock(adminCriticalLimit, adminCriticalWindow, now),
		accessFailures: ratelimit.NewWithClock(accessFailureLimit, accessFailureWindow, now),
		logoUploads:    ratelimit.NewWithClock(logoUploadLimit, logoUploadWindow, now),
	}
}

// withRateLimit runs after authorization, so only a verified actor is counted,
// and before CSRF and the operation, so rejected and malformed attempts still
// consume the actor's budget.
func (handler *Handler) withRateLimit(policy routePolicy, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		actor, ok := ActorFromContext(req.Context())
		if !ok {
			writeError(w, http.StatusServiceUnavailable, "admin_unavailable")
			return
		}
		buckets := []*ratelimit.Limiter{handler.limits.reads}
		if policy.Mutation {
			buckets = []*ratelimit.Limiter{handler.limits.writes}
			if criticalWrite(policy) {
				buckets = append(buckets, handler.limits.criticalWrites)
			}
		}
		for _, bucket := range buckets {
			if allowed, retryAfter := bucket.Take(actor.UserID); !allowed {
				handler.recordDeniedForActor(
					req, actor, adminsecurity.EventAuthorizationDenied,
					rateLimitedReasonCode, http.StatusTooManyRequests,
				)
				writeRateLimited(w, retryAfter)
				return
			}
		}
		next.ServeHTTP(w, req)
	})
}

// criticalWrite marks mutations that change who holds authority or whether an
// account may act: every recent-auth operation plus school-admin and trust
// grants.
func criticalWrite(policy routePolicy) bool {
	return policy.Mutation && (policy.RequiresRecentAuth ||
		policy.Capability == adminaccess.CapabilitySchoolGrantsManage ||
		policy.Capability == adminaccess.CapabilityTrustGrantsManage)
}

// accessFailureKey scopes bootstrap and step-up failures to one verified
// Access identity so another operator's failures cannot lock it out.
func accessFailureKey(issuer, subject string) string {
	return issuer + "\x00" + subject
}

func writeRateLimited(w http.ResponseWriter, retryAfter time.Duration) {
	seconds := int((retryAfter + time.Second - 1) / time.Second)
	w.Header().Set("Retry-After", strconv.Itoa(max(seconds, 1)))
	writeError(w, http.StatusTooManyRequests, rateLimitedReasonCode)
}
