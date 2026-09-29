package adminhttp

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminmutation"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/apperror"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/logoimage"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/schools"
)

const (
	// maximumLogoRequestBytes leaves room for the multipart framing and the two
	// short text fields around a maximum-size file.
	maximumLogoRequestBytes = logoimage.MaxBytes + 64<<10
	maximumLogoFieldBytes   = 4 << 10
	logoUploadLimit         = 10
	logoUploadWindow        = 15 * time.Minute
)

type AdminLogos interface {
	ReplaceLogo(context.Context, string, adminmutation.Command, logoimage.Image) (schools.AdminSchool, error)
	RemoveLogo(context.Context, string, adminmutation.Command) (schools.AdminSchool, error)
}

var errLogoRequestTooLarge = errors.New("logo request exceeds the size limit")

// readLogoUpload streams a multipart body with exactly the fields
// expected_updated_at, reason, and file. The file's name and declared type are
// ignored; only its bytes are passed on for validation.
func readLogoUpload(w http.ResponseWriter, req *http.Request) (adminmutation.Command, []byte, error) {
	req.Body = http.MaxBytesReader(w, req.Body, maximumLogoRequestBytes)
	invalid := apperror.Validation("logo upload requires expected_updated_at, reason, and one file")
	reader, err := req.MultipartReader()
	if err != nil {
		return adminmutation.Command{}, nil, invalid
	}
	var command adminmutation.Command
	var file []byte
	seen := map[string]bool{}
	for {
		part, err := reader.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return adminmutation.Command{}, nil, tooLargeOr(err, invalid)
		}
		name := part.FormName()
		if seen[name] {
			return adminmutation.Command{}, nil, invalid
		}
		seen[name] = true
		limit := int64(maximumLogoFieldBytes)
		if name == "file" {
			limit = logoimage.MaxBytes
		}
		value, err := io.ReadAll(io.LimitReader(part, limit+1))
		if err != nil {
			return adminmutation.Command{}, nil, tooLargeOr(err, invalid)
		}
		if int64(len(value)) > limit {
			if name == "file" {
				return adminmutation.Command{}, nil, errLogoRequestTooLarge
			}
			return adminmutation.Command{}, nil, invalid
		}
		switch name {
		case "file":
			file = value
		case "reason":
			command.Reason = string(value)
		case "expected_updated_at":
			command.ExpectedUpdatedAt, err = time.Parse(time.RFC3339Nano, strings.TrimSpace(string(value)))
			if err != nil {
				return adminmutation.Command{}, nil, invalid
			}
		default:
			return adminmutation.Command{}, nil, invalid
		}
	}
	if !seen["file"] || !seen["reason"] || !seen["expected_updated_at"] {
		return adminmutation.Command{}, nil, invalid
	}
	return command, file, nil
}

func tooLargeOr(err error, fallback error) error {
	var maxBytes *http.MaxBytesError
	if errors.As(err, &maxBytes) {
		return errLogoRequestTooLarge
	}
	return fallback
}
