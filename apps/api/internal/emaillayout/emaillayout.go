// Package emaillayout renders every email the site sends through one layout:
// a header with the site's name, the message, one main action as a button
// with its plain address beneath, and a footer saying why it was sent.
//
// Mail clients drop <style> blocks and block remote content, so the layout
// uses inline styles, the site's colors and system fonts, and no images.
// Every value is escaped by html/template, and an action's address must be
// http or https.
package emaillayout

import (
	"bytes"
	"fmt"
	"html/template"
	"strings"
)

// Message is one email's content. Paragraphs, details, and notes are plain
// text; the layout escapes them.
type Message struct {
	// Preview is the line inboxes show after the subject. It is hidden in the
	// body.
	Preview    string
	Heading    string
	Paragraphs []string
	Details    []Detail
	Action     *Action
	// Notes are smaller lines after the action, such as when a link expires.
	Notes  []string
	Reason string
}

// Detail is one labelled fact, such as an event's time.
type Detail struct {
	Label string
	Value string
}

// Action is the email's main button.
type Action struct {
	Label string
	URL   string
}

// The site's palette (apps/web/src/styles.css).
const (
	colorCanvas  = "#f8f8f8"
	colorSurface = "#ffffff"
	colorText    = "#0b0c0c"
	colorMuted   = "#505a5f"
	colorBorder  = "#d8dadb"
	colorHeader  = "#0b1622"
	colorPrimary = "#0057d9"
	fontStack    = "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
)

var layout = template.Must(template.New("email").Parse(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>{{.Heading}}</title>
<style>
@media (prefers-color-scheme: dark) {
  .cgn-canvas { background: #0b1622 !important; }
  .cgn-card { background: #16222f !important; border-color: #2b3a49 !important; }
  .cgn-text { color: #f3f2f1 !important; }
  .cgn-muted { color: #c5ccd3 !important; }
  .cgn-link { color: #8ab4f8 !important; }
}
</style>
</head>
<body class="cgn-canvas" style="margin:0;padding:0;background:` + colorCanvas + `;color:` + colorText + `;font-family:` + fontStack + `;">
{{if .Preview}}<div style="display:none;max-height:0;overflow:hidden;">{{.Preview}}</div>{{end}}
<table class="cgn-canvas" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:` + colorCanvas + `;">
<tr><td align="center" style="padding:24px 12px;">
<table class="cgn-card" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:` + colorSurface + `;border:1px solid ` + colorBorder + `;border-radius:4px;">
<tr><td style="background:` + colorHeader + `;padding:16px 24px;border-radius:4px 4px 0 0;color:#ffffff;font-size:16px;font-weight:700;">Campus Gaming Network</td></tr>
<tr><td class="cgn-text" style="padding:24px;font-size:16px;line-height:1.5;color:` + colorText + `;">
<h1 class="cgn-text" style="margin:0 0 16px;font-size:22px;line-height:1.3;color:` + colorText + `;">{{.Heading}}</h1>
{{range .Paragraphs}}<p style="margin:0 0 16px;">{{.}}</p>
{{end}}{{if .Details}}<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px;">
{{range .Details}}<tr><td style="padding:2px 12px 2px 0;font-weight:700;vertical-align:top;">{{.Label}}</td><td style="padding:2px 0;vertical-align:top;">{{.Value}}</td></tr>
{{end}}</table>
{{end}}{{with .Action}}<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 16px;"><tr><td style="background:` + colorPrimary + `;border-radius:4px;">
<a href="{{.URL}}" style="display:inline-block;padding:12px 20px;color:#ffffff;font-weight:700;text-decoration:none;">{{.Label}}</a>
</td></tr></table>
<p class="cgn-muted" style="margin:0 0 16px;font-size:14px;color:` + colorMuted + `;">If the button does not work, copy this address into your browser:<br><a class="cgn-link" href="{{.URL}}" style="color:` + colorPrimary + `;word-break:break-all;">{{.URL}}</a></p>
{{end}}{{range .Notes}}<p class="cgn-muted" style="margin:0 0 12px;font-size:14px;color:` + colorMuted + `;">{{.}}</p>
{{end}}</td></tr>
<tr><td class="cgn-muted" style="padding:16px 24px;border-top:1px solid ` + colorBorder + `;font-size:13px;line-height:1.5;color:` + colorMuted + `;">{{if .Reason}}{{.Reason}} {{end}}Campus Gaming Network</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`))

// HTML renders message through the shared layout.
func HTML(message Message) (string, error) {
	if message.Action != nil && !safeURL(message.Action.URL) {
		return "", fmt.Errorf("email action address must be http or https")
	}
	var out bytes.Buffer
	if err := layout.Execute(&out, message); err != nil {
		return "", fmt.Errorf("render email: %w", err)
	}
	return out.String(), nil
}

// Text renders message as plain text, for clients that show no HTML.
func Text(message Message) string {
	var out strings.Builder
	out.WriteString(message.Heading + "\n\n")
	for _, paragraph := range message.Paragraphs {
		out.WriteString(paragraph + "\n\n")
	}
	for _, detail := range message.Details {
		out.WriteString(detail.Label + ": " + detail.Value + "\n")
	}
	if len(message.Details) > 0 {
		out.WriteString("\n")
	}
	if message.Action != nil {
		out.WriteString(message.Action.Label + ": " + message.Action.URL + "\n\n")
	}
	for _, note := range message.Notes {
		out.WriteString(note + "\n\n")
	}
	out.WriteString("--\n")
	if message.Reason != "" {
		out.WriteString(message.Reason + "\n")
	}
	out.WriteString("Campus Gaming Network\n")
	return out.String()
}

func safeURL(value string) bool {
	return strings.HasPrefix(value, "https://") || strings.HasPrefix(value, "http://")
}
