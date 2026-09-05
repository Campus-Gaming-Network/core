package httpapi

import (
	"crypto/subtle"
	"net"
	"net/http"
	"net/netip"
	"strings"
)

const (
	visitorIPHeader   = "X-CGN-Visitor-IP"
	proxySecretHeader = "X-CGN-Proxy-Secret"
)

// clientKey trusts visitor identity only when the private BFF proves knowledge
// of the shared secret. A missing, malformed, or spoofed assertion falls back
// to the direct peer address.
func clientKey(req *http.Request, sharedSecret string) string {
	if sharedSecret != "" && secretsEqual(req.Header.Get(proxySecretHeader), sharedSecret) {
		if address, ok := parseIPAddress(req.Header.Get(visitorIPHeader)); ok {
			return address
		}
	}

	return remoteClientKey(req.RemoteAddr)
}

func secretsEqual(provided, expected string) bool {
	return subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) == 1
}

func remoteClientKey(remoteAddress string) string {
	value := strings.TrimSpace(remoteAddress)
	if value == "" {
		return "unknown"
	}

	if host, _, err := net.SplitHostPort(value); err == nil {
		if address, ok := parseIPAddress(host); ok {
			return address
		}
	}
	if address, ok := parseIPAddress(value); ok {
		return address
	}

	return value
}

func parseIPAddress(value string) (string, bool) {
	address, err := netip.ParseAddr(strings.TrimSpace(value))
	if err != nil {
		return "", false
	}

	return address.Unmap().String(), true
}
