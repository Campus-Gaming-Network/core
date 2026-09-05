package users

import (
	"net/mail"
	"strings"
)

// VerificationLevelAfterEmailVerification returns the account's trust level
// after its inbox has been verified. A qualifying .edu address is a limited
// trust indicator only; it is not proof of enrollment, affiliation, or
// identity.
//
// Only basic accounts are eligible for promotion. Staff/faculty and any other
// higher grant are preserved.
func VerificationLevelAfterEmailVerification(email string, currentLevel string) string {
	if currentLevel != "basic" {
		return currentLevel
	}
	if hasQualifyingEDUDomain(email) {
		return "verified"
	}
	return currentLevel
}

func hasQualifyingEDUDomain(email string) bool {
	candidate := strings.TrimSpace(email)
	address, err := mail.ParseAddress(candidate)
	if err != nil || address.Name != "" || !strings.EqualFold(address.Address, candidate) {
		return false
	}

	at := strings.LastIndexByte(address.Address, '@')
	if at <= 0 || at == len(address.Address)-1 {
		return false
	}
	domain := strings.ToLower(address.Address[at+1:])
	if len(domain) > 253 || !strings.HasSuffix(domain, ".edu") {
		return false
	}

	labels := strings.Split(domain, ".")
	if len(labels) < 2 || labels[len(labels)-1] != "edu" {
		return false
	}
	for _, label := range labels {
		if !isValidDomainLabel(label) {
			return false
		}
	}
	return true
}

func isValidDomainLabel(label string) bool {
	if len(label) == 0 || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
		return false
	}
	for _, character := range label {
		if (character < 'a' || character > 'z') &&
			(character < '0' || character > '9') &&
			character != '-' {
			return false
		}
	}
	return true
}
