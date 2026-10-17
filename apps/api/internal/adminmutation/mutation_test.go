package adminmutation

import (
	"reflect"
	"testing"
)

func TestEditedFieldsNamesOnlyTheFieldsWhoseValuesDiffer(t *testing.T) {
	type form struct {
		Name      string   `json:"name"`
		ShortName string   `json:"short_name"`
		Latitude  *float64 `json:"latitude"`
		Active    bool     `json:"is_active"`
	}
	latitude := 45.5
	edited, err := EditedFields(
		form{Name: "Portland State", ShortName: "PSU", Active: true},
		form{Name: "Portland State", ShortName: "Portland St.", Latitude: &latitude, Active: true},
	)
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"latitude", "short_name"}; !reflect.DeepEqual(edited, want) {
		t.Fatalf("EditedFields() = %#v, want %#v", edited, want)
	}
}
