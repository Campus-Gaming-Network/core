package seed

// Hand-written vocabulary for the demo dataset. gofakeit supplies names, streets,
// and filler text; these lists give events, teams, and moderation records
// gaming-specific wording.

var demoGameSlugs = []string{
	"rocket-league", "valorant", "league-of-legends", "overwatch-2",
	"super-smash-bros-ultimate", "csgo",
}

var demoEventKinds = []string{
	"Weekly Scrims", "Open Tournament", "Watch Party", "Casual Night", "Bootcamp",
	"LAN Party", "Beginner Clinic", "Ladder Finals", "Community Cup", "Practice Block",
	"Meet and Greet", "Showmatch", "Bracket Night", "Coaching Session", "Charity Stream",
}

var demoEventModifiers = []string{
	"Spring Edition", "Fall Kickoff", "Finals Week", "Midnight Run", "Rookie Series", "Grand Slam",
	"Weekend Special", "Friendly", "Pro-Am", "Open Invite", "Season Opener", "Alumni Night",
}

var demoEventVenues = []string{
	"Student Union Ballroom", "Esports Arena", "Engineering Hall 204", "Library Media Lab",
	"Recreation Center Annex", "Innovation Commons", "Residence Hall Lounge", "Campus Theater",
}

var demoEventPitches = []string{
	"Bring your own controller or headset.",
	"All skill levels are welcome.",
	"Expect a relaxed bracket with prizes for the top finishers.",
	"We will split into balanced teams on arrival.",
	"Snacks and drinks are provided.",
	"Spectators are welcome and there is a casting desk.",
	"Sign in at the front table and check the pinned channel for updates.",
	"We start on time, so plan to arrive ten minutes early.",
}

var demoPaymentNotes = []string{
	"Entry fee goes to the prize pool and is paid to the organizer at check-in.",
	"Venmo the organizer after you RSVP.",
	"Cash donation at the door supports travel to nationals.",
}

var demoTimezones = []string{
	"America/New_York", "America/Chicago", "America/Denver", "America/Phoenix",
	"America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu",
}

var demoTeamSuffixes = []string{
	"Esports", "Gaming", "Varsity", "JV", "Academy", "Red", "Blue", "Black", "Gold",
	"Collective", "Squad", "Club",
}

var demoTeamMascots = []string{
	"Phoenix", "Wolves", "Titans", "Vipers", "Ravens", "Comets", "Nova", "Storm",
	"Knights", "Falcons", "Wildcats", "Dragons", "Rogues", "Sentinels",
}

var demoUnicodeNames = []string{
	"José Álvarez", "Nguyễn Thị Mai", "Zoë Müller", "李小龍", "Søren Østergaard",
	"Amélie Dubois", "Łukasz Kowalski", "Priya Raghavan", "Dmitri Ivanov",
}

var demoSocialLabels = []struct{ Label, URL string }{
	{"Twitch", "https://twitch.tv/"},
	{"YouTube", "https://youtube.com/@"},
	{"Steam", "https://steamcommunity.com/id/"},
	{"X", "https://x.com/"},
	{"Discord", "https://discord.com/users/"},
}

var demoReportReasons = []string{
	"Spam promotion in the event description.",
	"This event looks like a duplicate of another listing.",
	"The organizer is using offensive language in the title.",
	"Suspicious payment link on this event.",
	"This profile appears to impersonate another student.",
	"Harassment in the pinned event discussion.",
	"Event lists the wrong school and location.",
}

var demoResolutionNotes = []string{
	"Reviewed and removed the offending text.",
	"No violation found; closed without action.",
	"Contacted the organizer, who corrected the listing.",
	"Merged with an earlier report.",
}

var demoTicketSubjects = []string{
	"Cannot verify my school email",
	"Change my home school",
	"Event capacity is not updating",
	"Request to add a new game",
	"My school logo is missing",
	"Password reset email never arrived",
	"How do I transfer event ownership?",
	"Report a bug with recurring events",
}

var demoTicketMessages = []string{
	"I tried again this morning and it still does not work. Please advise.",
	"Happy to provide screenshots if that helps.",
	"This started after I updated my profile last week.",
	"Our club is hosting a large event soon and needs this sorted.",
}

var demoNotificationKinds = []struct{ Type, Title, Body, Entity string }{
	{"event.reminder", "Event starting soon", "An event you RSVPed to starts within the day.", "event"},
	{"event.cancelled", "Event cancelled", "An organizer cancelled an event you RSVPed to.", "event"},
	{"rsvp.confirmed", "RSVP confirmed", "Your RSVP was recorded.", "event"},
	{"team.member_joined", "New teammate", "Someone joined your team.", "team"},
	{"school.follow", "New followers", "Players from your school followed the same schools as you.", ""},
}
