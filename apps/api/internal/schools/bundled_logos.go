package schools

import (
	_ "embed"
	"encoding/json"
	"fmt"
)

// bundledLogosJSON is generated from apps/web/public/school-logos/manifest.json
// by scripts/collect_school_logos.ts, which also fails its --check when the two
// differ. The file stays inside this package because embed cannot read outside
// apps/api.
//
//go:embed bundled_logos.json
var bundledLogosJSON []byte

type bundledLogo struct {
	UnitID    int64  `json:"unitid"`
	Slug      string `json:"slug"`
	Asset     string `json:"asset"`
	Athletics bool   `json:"athletics"`
}

// bundledLogos is keyed by unit ID. An athletics mark replaces the
// institutional logo for the same school, as it does on the main site.
var bundledLogos = mustLoadBundledLogos(bundledLogosJSON)

func mustLoadBundledLogos(data []byte) map[int64]bundledLogo {
	var entries []bundledLogo
	if err := json.Unmarshal(data, &entries); err != nil {
		panic(fmt.Sprintf("schools: invalid bundled logo lookup: %v", err))
	}
	logos := make(map[int64]bundledLogo, len(entries))
	for _, entry := range entries {
		logos[entry.UnitID] = entry
	}
	return logos
}

// BundledLogoAsset returns the bundled logo's asset path, such as
// "/school-logos/100654-b7eb4f62bf8d.png". It matches the school's unit ID and
// then requires the seed slug to be the same, so a changed or reused identity
// never inherits a logo and nothing is guessed from a name or a main campus.
func BundledLogoAsset(unitID *int64, slug string) (string, bool) {
	if unitID == nil {
		return "", false
	}
	logo, ok := bundledLogos[*unitID]
	if !ok || logo.Slug != slug {
		return "", false
	}
	return logo.Asset, true
}

// AdminSchoolDetail is the school details response: the school plus the logo
// the main site falls back to when the school has no Admin Console upload.
type AdminSchoolDetail struct {
	AdminSchool
	// BundledLogoURL is set only when the school has a bundled logo and the
	// public asset origin is configured. It is reported whether or not an
	// upload exists, so the admin can see what removing the upload falls back to.
	BundledLogoURL string `json:"bundled_logo_url,omitempty"`
}

// NewAdminSchoolDetail adds the bundled logo, which sync:school-logos stores
// under bundled/ in the logo bucket, to a school. assetOrigin has no trailing
// slash; an empty one means logo storage is not configured.
func NewAdminSchoolDetail(school AdminSchool, assetOrigin string) AdminSchoolDetail {
	detail := AdminSchoolDetail{AdminSchool: school}
	if asset, ok := BundledLogoAsset(school.UnitID, school.Slug); ok && assetOrigin != "" {
		detail.BundledLogoURL = assetOrigin + "/bundled" + asset
	}
	return detail
}
