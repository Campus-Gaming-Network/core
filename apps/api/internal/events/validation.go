package events

import (
	"errors"
	"net/url"
	"strings"
	"time"
	_ "time/tzdata"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/apperror"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/safety"
)

// NormalizeListParams applies the event list's pagination and filter defaults.
func NormalizeListParams(params ListParams) ListParams {
	params.GameSlug = strings.TrimSpace(params.GameSlug)
	params.SchoolSlug = strings.TrimSpace(params.SchoolSlug)
	params.Format = strings.TrimSpace(params.Format)
	if params.Format != "" && params.Format != FormatOnline && params.Format != FormatInPerson && params.Format != FormatHybrid {
		params.Format = ""
	}
	if params.Limit < 1 || params.Limit > 101 {
		params.Limit = 25
	}
	return params
}

func ValidateCreateInput(input CreateInput) error {
	return validateEventFields(input, true)
}

func ValidateUpdateInput(input UpdateInput) error {
	if strings.TrimSpace(input.Slug) == "" {
		return apperror.Validation("event slug is required")
	}
	if strings.TrimSpace(input.EditorUserID) == "" {
		return apperror.Validation("editor user is required")
	}
	return validateEventFields(CreateInput{
		Title:           input.Title,
		Description:     input.Description,
		CreatorUserID:   input.EditorUserID,
		HostSchoolID:    input.HostSchoolID,
		GameIDs:         input.GameIDs,
		Visibility:      input.Visibility,
		Format:          input.Format,
		StartsAt:        input.StartsAt,
		EndsAt:          input.EndsAt,
		Timezone:        input.Timezone,
		LocationName:    input.LocationName,
		Address:         input.Address,
		OnlineURL:       input.OnlineURL,
		PrivatePassword: input.PrivatePassword,
		Capacity:        input.Capacity,
		IsPaid:          input.IsPaid,
		PaymentNote:     input.PaymentNote,
		PaymentURL:      input.PaymentURL,
	}, false)
}

func ValidateRSVPInput(input RSVPInput) error {
	if strings.TrimSpace(input.Slug) == "" {
		return apperror.Validation("event slug is required")
	}
	if strings.TrimSpace(input.UserID) == "" {
		return apperror.Validation("user is required")
	}
	if !validRSVPResponse(input.Response) {
		return apperror.Validation("rsvp response must be yes, maybe, or no")
	}
	return nil
}

func validateEventFields(input CreateInput, requirePrivatePassword bool) error {
	if title := strings.TrimSpace(input.Title); title == "" || len(title) > 120 {
		return apperror.Validation("title is required and must be 120 characters or fewer")
	}
	if err := safety.ValidateCleanText("title", input.Title); err != nil {
		return err
	}
	if len(input.Description) > 5000 {
		return apperror.Validation("description must be 5,000 characters or fewer")
	}
	if err := safety.ValidateCleanText("description", input.Description); err != nil {
		return err
	}
	if strings.TrimSpace(input.CreatorUserID) == "" {
		return apperror.Validation("creator user is required")
	}
	if strings.TrimSpace(input.HostSchoolID) == "" {
		return apperror.Validation("host school is required")
	}
	if len(input.GameIDs) == 0 {
		return apperror.Validation("at least one game is required")
	}
	for _, gameID := range input.GameIDs {
		if strings.TrimSpace(gameID) == "" {
			return apperror.Validation("game IDs must be valid")
		}
	}
	if !validVisibility(input.Visibility) {
		return apperror.Validation("visibility must be public, unlisted, or private")
	}
	if !validFormat(input.Format) {
		return apperror.Validation("format must be online, in_person, or hybrid")
	}
	if input.StartsAt.IsZero() || input.EndsAt.IsZero() || !input.EndsAt.After(input.StartsAt) {
		return apperror.Validation("event end time must be after start time")
	}
	timezone := strings.TrimSpace(input.Timezone)
	if timezone == "" {
		return apperror.Validation("timezone is required")
	}
	location, err := time.LoadLocation(timezone)
	if err != nil {
		return apperror.Validation("timezone must be a valid IANA timezone")
	}
	if len(input.LocationName) > 200 {
		return apperror.Validation("location name must be 200 characters or fewer")
	}
	if err := safety.ValidateCleanText("location name", input.LocationName); err != nil {
		return err
	}
	if len(input.Address) > 1000 {
		return apperror.Validation("address must be 1,000 characters or fewer")
	}
	if len(input.OnlineURL) > 500 {
		return apperror.Validation("online URL must be 500 characters or fewer")
	}
	if strings.TrimSpace(input.OnlineURL) != "" {
		if err := validateHTTPURL(input.OnlineURL); err != nil {
			return apperror.Validation("online URL must be a valid HTTP or HTTPS URL")
		}
	}
	privatePassword := strings.TrimSpace(input.PrivatePassword)
	if input.Visibility == VisibilityPrivate && requirePrivatePassword && len(privatePassword) < 8 {
		return apperror.Validation("private events require a password of at least 8 characters")
	}
	if input.Visibility != VisibilityPrivate && privatePassword != "" {
		return apperror.Validation("only private events may have a private password")
	}
	if input.Visibility == VisibilityPrivate && !requirePrivatePassword && privatePassword != "" && len(privatePassword) < 8 {
		return apperror.Validation("private event password must be at least 8 characters")
	}
	if input.Capacity != nil && *input.Capacity < 1 {
		return apperror.Validation("capacity must be positive when set")
	}
	if input.RecurrenceRule != "" {
		if !validRecurrenceRule(input.RecurrenceRule) || input.RecurrenceUntil.IsZero() || !input.RecurrenceUntil.After(input.EndsAt) {
			return apperror.Validation("recurrence must have a valid rule and end date after the event")
		}
		startDate := input.StartsAt.In(location)
		oneYearLater := time.Date(
			startDate.Year(), startDate.Month(), startDate.Day(),
			0, 0, 0, 0, location,
		).AddDate(1, 0, 0)
		if calendarDateAfter(input.RecurrenceUntil.In(location), oneYearLater) {
			return apperror.Validation("recurrence cannot extend more than one year")
		}
	} else if !input.RecurrenceUntil.IsZero() {
		return apperror.Validation("recurrence end date requires a recurrence rule")
	}
	if len(input.PaymentNote) > 1000 {
		return apperror.Validation("payment note must be 1,000 characters or fewer")
	}
	if err := safety.ValidateCleanText("payment note", input.PaymentNote); err != nil {
		return err
	}
	if strings.TrimSpace(input.PaymentURL) != "" {
		if err := validateHTTPURL(input.PaymentURL); err != nil {
			return apperror.Validation("payment URL must be a valid HTTP or HTTPS URL")
		}
	}
	return nil
}

func calendarDateAfter(value time.Time, limit time.Time) bool {
	valueYear, valueMonth, valueDay := value.Date()
	limitYear, limitMonth, limitDay := limit.Date()
	valueDate := time.Date(valueYear, valueMonth, valueDay, 0, 0, 0, 0, time.UTC)
	limitDate := time.Date(limitYear, limitMonth, limitDay, 0, 0, 0, 0, time.UTC)
	return valueDate.After(limitDate)
}

func validVisibility(value string) bool {
	return value == VisibilityPublic || value == VisibilityUnlisted || value == VisibilityPrivate
}

func validFormat(value string) bool {
	return value == FormatOnline || value == FormatInPerson || value == FormatHybrid
}

func validRecurrenceRule(value string) bool {
	return value == RecurrenceWeekly || value == RecurrenceBiweekly || value == RecurrenceMonthly
}

func validRSVPResponse(value string) bool {
	value = strings.TrimSpace(value)
	return value == RSVPYes || value == RSVPMaybe || value == RSVPNo
}

func normalizeCreateParams(params CreateParams) CreateParams {
	params.Title = strings.TrimSpace(params.Title)
	params.Description = strings.TrimSpace(params.Description)
	params.CreatorUserID = strings.TrimSpace(params.CreatorUserID)
	params.HostSchoolID = strings.TrimSpace(params.HostSchoolID)
	params.GameIDs = normalizeIDs(params.GameIDs)
	params.Visibility = strings.TrimSpace(params.Visibility)
	params.Format = strings.TrimSpace(params.Format)
	params.Timezone = strings.TrimSpace(params.Timezone)
	params.LocationName = strings.TrimSpace(params.LocationName)
	params.Address = strings.TrimSpace(params.Address)
	params.OnlineURL = strings.TrimSpace(params.OnlineURL)
	params.PrivatePasswordHash = strings.TrimSpace(params.PrivatePasswordHash)
	params.PaymentNote = strings.TrimSpace(params.PaymentNote)
	params.PaymentURL = strings.TrimSpace(params.PaymentURL)
	params.RecurrenceRule = strings.TrimSpace(params.RecurrenceRule)
	return params
}

func normalizeUpdateParams(params UpdateParams) UpdateParams {
	params.Slug = strings.TrimSpace(params.Slug)
	params.EditorUserID = strings.TrimSpace(params.EditorUserID)
	params.Title = strings.TrimSpace(params.Title)
	params.Description = strings.TrimSpace(params.Description)
	params.HostSchoolID = strings.TrimSpace(params.HostSchoolID)
	params.GameIDs = normalizeIDs(params.GameIDs)
	params.Visibility = strings.TrimSpace(params.Visibility)
	params.Format = strings.TrimSpace(params.Format)
	params.Timezone = strings.TrimSpace(params.Timezone)
	params.LocationName = strings.TrimSpace(params.LocationName)
	params.Address = strings.TrimSpace(params.Address)
	params.OnlineURL = strings.TrimSpace(params.OnlineURL)
	params.PrivatePasswordHash = strings.TrimSpace(params.PrivatePasswordHash)
	params.PaymentNote = strings.TrimSpace(params.PaymentNote)
	params.PaymentURL = strings.TrimSpace(params.PaymentURL)
	return params
}

func normalizeRSVPInput(input RSVPInput) RSVPInput {
	input.Slug = strings.TrimSpace(input.Slug)
	input.UserID = strings.TrimSpace(input.UserID)
	input.Response = strings.TrimSpace(input.Response)
	return input
}

func normalizeIDs(values []string) []string {
	result := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		result = append(result, trimmed)
	}
	return result
}

func validateHTTPURL(value string) error {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed.Host == "" || (parsed.Scheme != "https" && parsed.Scheme != "http") {
		return errors.New("invalid HTTP URL")
	}
	return nil
}
