package events

import (
	"errors"
	"math/bits"
)

// PlannedMatch is one match of a single-elimination bracket before it is
// stored. Seeds holds the seeds known when the bracket is generated; 0 is a
// slot an earlier match decides. The final has no next match.
type PlannedMatch struct {
	Round    int
	Position int
	Seeds    [2]int
	// NextPosition and NextSlot place the winner in the next round: the
	// match at NextPosition there, in slot NextSlot (1 or 2).
	NextPosition int
	NextSlot     int
}

var errTooFewEntrants = errors.New("a bracket needs two or more entrants")

// PlanSingleElimination plans a single-elimination bracket for entrants
// seeded 1 to entrants (docs/01-product.md, Tournaments). The bracket is
// sized to the next power of two, and the standard seed order pairs the top
// seed with the bottom one, so the byes go to the top seeds. A bye advances
// its entrant without a match, so first-round positions with a bye have no
// match and the entrant waits in its second-round slot. The result is in
// round, then position order, and the same count always gives the same plan.
func PlanSingleElimination(entrants int) ([]PlannedMatch, error) {
	if entrants < 2 {
		return nil, errTooFewEntrants
	}
	size := 1 << bits.Len(uint(entrants-1))
	order := seedOrder(size)
	rounds := bits.Len(uint(size)) - 1

	// waiting holds the seeds that byes moved into second-round slots.
	waiting := map[[2]int]int{}
	var matches []PlannedMatch
	for round := 1; round <= rounds; round++ {
		count := size >> round
		for position := 1; position <= count; position++ {
			match := PlannedMatch{Round: round, Position: position}
			if round < rounds {
				match.NextPosition = (position + 1) / 2
				match.NextSlot = 2 - position%2
			}
			if round == 1 {
				high, low := order[2*position-2], order[2*position-1]
				if low > entrants {
					waiting[[2]int{match.NextPosition, match.NextSlot}] = high
					continue
				}
				match.Seeds = [2]int{high, low}
			} else if round == 2 {
				match.Seeds = [2]int{waiting[[2]int{position, 1}], waiting[[2]int{position, 2}]}
			}
			matches = append(matches, match)
		}
	}
	return matches, nil
}

// seedOrder lists the seeds of a bracket of size (a power of two) in slot
// order, so that consecutive pairs meet in the first round and the top seeds
// meet as late as possible: 1, 8, 4, 5, 2, 7, 3, 6 for eight.
func seedOrder(size int) []int {
	order := []int{1}
	for length := 1; length < size; length *= 2 {
		next := make([]int, 0, 2*length)
		for _, seed := range order {
			next = append(next, seed, 2*length+1-seed)
		}
		order = next
	}
	return order
}
