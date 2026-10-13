package schools

import "testing"

func TestBundledLogoAsset(t *testing.T) {
	alabamaAM, amridge, unknown := int64(100654), int64(100690), int64(1)
	tests := []struct {
		name   string
		unitID *int64
		slug   string
		want   string
		wantOK bool
	}{
		{name: "an athletics mark replaces the institutional logo", unitID: &alabamaAM, slug: "alabama-a-m-university", want: "/school-logos/100654-athletics-6d724cd04d41.png", wantOK: true},
		{name: "an institutional logo without an athletics mark", unitID: &amridge, slug: "amridge-university", want: "/school-logos/100690-55cc7ac2a75d.svg", wantOK: true},
		{name: "a different slug", unitID: &amridge, slug: "amridge-university-2"},
		{name: "an unknown unit ID", unitID: &unknown, slug: "amridge-university"},
		{name: "no unit ID", slug: "amridge-university"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, ok := BundledLogoAsset(test.unitID, test.slug)
			if got != test.want || ok != test.wantOK {
				t.Fatalf("BundledLogoAsset = %q, %t; want %q, %t", got, ok, test.want, test.wantOK)
			}
		})
	}
}

func TestNewAdminSchoolDetailReportsTheBundledLogoInTheLogoBucket(t *testing.T) {
	unitID := int64(100690)
	bundled := AdminSchool{AdminFields: AdminFields{UnitID: &unitID, Slug: "amridge-university"}, LogoURL: "https://assets.example.test/school-logos/upload.png"}
	other := AdminSchool{AdminFields: AdminFields{UnitID: &unitID, Slug: "renamed"}}
	tests := []struct {
		name   string
		school AdminSchool
		origin string
		want   AdminSchoolDetail
	}{
		{name: "a bundled school with an upload", school: bundled, origin: "https://assets.example.test", want: AdminSchoolDetail{AdminSchool: bundled, BundledLogoURL: "https://assets.example.test/bundled/school-logos/100690-55cc7ac2a75d.svg"}},
		{name: "a school without a bundled logo", school: other, origin: "https://assets.example.test", want: AdminSchoolDetail{AdminSchool: other}},
		{name: "logo storage not configured", school: bundled, want: AdminSchoolDetail{AdminSchool: bundled}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := NewAdminSchoolDetail(test.school, test.origin); got != test.want {
				t.Fatalf("NewAdminSchoolDetail = %#v; want %#v", got, test.want)
			}
		})
	}
}
