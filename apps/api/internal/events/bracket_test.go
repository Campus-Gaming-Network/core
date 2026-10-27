package events

import (
	"reflect"
	"testing"
)

func TestPlanSingleElimination(t *testing.T) {
	// m builds a planned match: round, position, the two known seeds, and
	// where the winner goes.
	m := func(round, position, high, low, nextPosition, nextSlot int) PlannedMatch {
		return PlannedMatch{Round: round, Position: position, Seeds: [2]int{high, low}, NextPosition: nextPosition, NextSlot: nextSlot}
	}
	for _, test := range []struct {
		entrants int
		want     []PlannedMatch
	}{
		{2, []PlannedMatch{m(1, 1, 1, 2, 0, 0)}},
		// Seed 1 has the bye and waits in the final.
		{3, []PlannedMatch{
			m(1, 2, 2, 3, 1, 2),
			m(2, 1, 1, 0, 0, 0),
		}},
		// Three byes for seeds 1 to 3; seeds 2 and 3 meet in round two.
		{5, []PlannedMatch{
			m(1, 2, 4, 5, 1, 2),
			m(2, 1, 1, 0, 1, 1),
			m(2, 2, 2, 3, 1, 2),
			m(3, 1, 0, 0, 0, 0),
		}},
		{8, []PlannedMatch{
			m(1, 1, 1, 8, 1, 1),
			m(1, 2, 4, 5, 1, 2),
			m(1, 3, 2, 7, 2, 1),
			m(1, 4, 3, 6, 2, 2),
			m(2, 1, 0, 0, 1, 1),
			m(2, 2, 0, 0, 1, 2),
			m(3, 1, 0, 0, 0, 0),
		}},
		// Sixteen slots: seeds 1 to 3 have byes and wait in round two.
		{13, []PlannedMatch{
			m(1, 2, 8, 9, 1, 2),
			m(1, 3, 4, 13, 2, 1),
			m(1, 4, 5, 12, 2, 2),
			m(1, 6, 7, 10, 3, 2),
			m(1, 8, 6, 11, 4, 2),
			m(2, 1, 1, 0, 1, 1),
			m(2, 2, 0, 0, 1, 2),
			m(2, 3, 2, 0, 2, 1),
			m(2, 4, 3, 0, 2, 2),
			m(3, 1, 0, 0, 1, 1),
			m(3, 2, 0, 0, 1, 2),
			m(4, 1, 0, 0, 0, 0),
		}},
	} {
		got, err := PlanSingleElimination(test.entrants)
		if err != nil {
			t.Fatalf("PlanSingleElimination(%d) error = %v", test.entrants, err)
		}
		if !reflect.DeepEqual(got, test.want) {
			t.Errorf("PlanSingleElimination(%d) =\n%+v\nwant\n%+v", test.entrants, got, test.want)
		}
	}
	if _, err := PlanSingleElimination(1); err != errTooFewEntrants {
		t.Fatalf("PlanSingleElimination(1) error = %v, want %v", err, errTooFewEntrants)
	}
}
