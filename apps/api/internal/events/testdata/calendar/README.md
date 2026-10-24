# Calendar fixtures

One event in three states: as created, after an edit that moves it a day,
and after it is cancelled. The Go RSVP attachment
(`apps/api/internal/events/mailer_test.go`) and the web export
(`apps/web/tests/event-calendar.test.ts`) both render each `.json` and must
produce the matching `.ics` exactly, so a file from either replaces the other
in a calendar. The files use `DTSTAMP:20370201T120000Z` and the event URL
`https://cgn.test/events/smash-night-finals`.
