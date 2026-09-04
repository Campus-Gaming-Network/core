package teams

import (
	"strings"
	"testing"
)

func TestValidateCreateInputRejectsBlockedLanguageInDescription(t *testing.T) {
	err := ValidateCreateInput(CreateInput{
		Name:        "Varsity Rocket League",
		Description: "A bullshit team description",
		OwnerUserID: "user-id",
		GameIDs:     []string{"game-id"},
		Password:    "TeamPass8",
	})
	if err == nil || !strings.Contains(err.Error(), "description contains language that is not allowed") {
		t.Fatalf("ValidateCreateInput() error = %v, want blocked-language error for description", err)
	}
}
