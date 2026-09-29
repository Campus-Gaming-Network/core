package logoimage

import (
	"bytes"
	"encoding/binary"
	"errors"
	"hash/crc32"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"testing"
)

func encodePNG(t *testing.T, source image.Image) []byte {
	t.Helper()
	var output bytes.Buffer
	if err := png.Encode(&output, source); err != nil {
		t.Fatal(err)
	}
	return output.Bytes()
}

func pngChunk(kind string, data []byte) []byte {
	chunk := binary.BigEndian.AppendUint32(nil, uint32(len(data)))
	chunk = append(chunk, kind...)
	chunk = append(chunk, data...)
	return binary.BigEndian.AppendUint32(chunk, crc32.ChecksumIEEE(chunk[4:]))
}

// withChunkAfterIHDR inserts a chunk between the 33-byte signature+IHDR
// prefix and the rest of an encoded PNG.
func withChunkAfterIHDR(encoded []byte, chunk []byte) []byte {
	return append(append(bytes.Clone(encoded[:33]), chunk...), encoded[33:]...)
}

func TestProcessReencodesPNGWithoutMetadata(t *testing.T) {
	source := image.NewNRGBA(image.Rect(0, 0, 3, 2))
	source.Set(0, 0, color.NRGBA{R: 255, A: 128})
	upload := withChunkAfterIHDR(encodePNG(t, source), pngChunk("tEXt", []byte("Comment\x00<script>alert(1)</script>")))

	logo, err := Process(upload)
	if err != nil {
		t.Fatal(err)
	}
	if logo.ContentType != "image/png" || logo.Extension != ".png" || bytes.Contains(logo.Body, []byte("tEXt")) {
		t.Fatalf("logo = %q %q with text chunk %v", logo.ContentType, logo.Extension, bytes.Contains(logo.Body, []byte("tEXt")))
	}
	decoded, err := png.Decode(bytes.NewReader(logo.Body))
	if err != nil {
		t.Fatal(err)
	}
	if got := color.NRGBAModel.Convert(decoded.At(0, 0)); got != (color.NRGBA{R: 255, A: 128}) || decoded.Bounds() != source.Bounds() {
		t.Fatalf("decoded pixel %v bounds %v", got, decoded.Bounds())
	}
}

func TestProcessUprightsJPEGAndDropsEXIF(t *testing.T) {
	source := image.NewRGBA(image.Rect(0, 0, 40, 20))
	var encoded bytes.Buffer
	if err := jpeg.Encode(&encoded, source, nil); err != nil {
		t.Fatal(err)
	}
	// A big-endian TIFF IFD0 with orientation 6 (rotate 90° clockwise) and a
	// GPS pointer, carried in an APP1 segment directly after SOI.
	tiff := []byte("MM\x00*\x00\x00\x00\x08\x00\x02" +
		"\x01\x12\x00\x03\x00\x00\x00\x01\x00\x06\x00\x00" +
		"\x88\x25\x00\x04\x00\x00\x00\x01\x00\x00\x00\x00" +
		"\x00\x00\x00\x00")
	app1 := append([]byte("Exif\x00\x00"), tiff...)
	segment := append([]byte{0xFF, 0xE1}, binary.BigEndian.AppendUint16(nil, uint16(len(app1)+2))...)
	upload := append(append(bytes.Clone(encoded.Bytes()[:2]), append(segment, app1...)...), encoded.Bytes()[2:]...)

	logo, err := Process(upload)
	if err != nil {
		t.Fatal(err)
	}
	if logo.ContentType != "image/jpeg" || bytes.Contains(logo.Body, []byte("Exif")) {
		t.Fatalf("logo %q keeps EXIF: %v", logo.ContentType, bytes.Contains(logo.Body, []byte("Exif")))
	}
	config, err := jpeg.DecodeConfig(bytes.NewReader(logo.Body))
	if err != nil {
		t.Fatal(err)
	}
	if config.Width != 20 || config.Height != 40 {
		t.Fatalf("oriented size = %dx%d, want 20x40", config.Width, config.Height)
	}
}

func TestProcessScalesLargeLogosAndAcceptsLimits(t *testing.T) {
	for _, test := range []struct {
		name          string
		width, height int
		want          image.Rectangle
	}{
		{name: "longest side at the limit", width: MaxSide, height: 2, want: image.Rect(0, 0, OutputSide, 1)},
		{name: "pixel count at the limit", width: 4000, height: 4000, want: image.Rect(0, 0, OutputSide, OutputSide)},
		{name: "tall image", width: 100, height: 1024, want: image.Rect(0, 0, 50, OutputSide)},
	} {
		t.Run(test.name, func(t *testing.T) {
			logo, err := Process(encodePNG(t, image.NewGray(image.Rect(0, 0, test.width, test.height))))
			if err != nil {
				t.Fatal(err)
			}
			config, err := png.DecodeConfig(bytes.NewReader(logo.Body))
			if err != nil {
				t.Fatal(err)
			}
			if got := image.Rect(0, 0, config.Width, config.Height); got != test.want {
				t.Fatalf("size = %v, want %v", got, test.want)
			}
		})
	}
}

func TestProcessRejectsUnsafeUploads(t *testing.T) {
	valid := encodePNG(t, image.NewGray(image.Rect(0, 0, 2, 2)))
	ihdr := func(width, height uint32) []byte {
		data := binary.BigEndian.AppendUint32(binary.BigEndian.AppendUint32(nil, width), height)
		return append(data, 8, 0, 0, 0, 0)
	}
	// Tiny compressed payloads that declare enormous canvases.
	bomb := func(width, height uint32) []byte {
		upload := append(bytes.Clone(pngSignature), pngChunk("IHDR", ihdr(width, height))...)
		upload = append(upload, pngChunk("IDAT", valid[41:len(valid)-16])...)
		return append(upload, pngChunk("IEND", nil)...)
	}

	for _, test := range []struct {
		name   string
		upload []byte
		want   error
	}{
		{name: "over the byte limit", upload: make([]byte, MaxBytes+1), want: ErrTooLarge},
		{name: "empty", upload: nil, want: ErrUnsupported},
		{name: "SVG", upload: []byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`), want: ErrUnsupported},
		{name: "HTML", upload: []byte("<!doctype html><script>alert(1)</script>"), want: ErrUnsupported},
		{name: "JavaScript", upload: []byte("alert(1)"), want: ErrUnsupported},
		{name: "GIF", upload: []byte("GIF89a\x01\x00\x01\x00\x00\x00\x00;"), want: ErrUnsupported},
		{name: "WebP", upload: []byte("RIFF\x1a\x00\x00\x00WEBPVP8L"), want: ErrUnsupported},
		{name: "ZIP", upload: []byte("PK\x03\x04\x14\x00\x00\x00"), want: ErrUnsupported},
		{name: "executable", upload: []byte("MZ\x90\x00\x03\x00\x00\x00"), want: ErrUnsupported},
		{name: "animated PNG", upload: withChunkAfterIHDR(valid, pngChunk("acTL", make([]byte, 8))), want: ErrUnsupported},
		{name: "PNG with an appended archive", upload: append(bytes.Clone(valid), "PK\x05\x06"...), want: ErrInvalid},
		{name: "truncated PNG", upload: valid[:len(valid)-20], want: ErrInvalid},
		{name: "PNG with a corrupt header", upload: append(bytes.Clone(pngSignature), pngChunk("IDAT", nil)...), want: ErrInvalid},
		{name: "JPEG with an appended archive", upload: []byte("\xFF\xD8\xFF\xD9PK\x05\x06"), want: ErrInvalid},
		{name: "truncated JPEG", upload: []byte("\xFF\xD8\xFF\xE0\x00\x10JFIF"), want: ErrInvalid},
		{name: "JPEG markers without an image", upload: []byte("\xFF\xD8\xFF\xD9"), want: ErrInvalid},
		{name: "side over the limit", upload: bomb(MaxSide+1, 1), want: ErrDimensions},
		{name: "pixel bomb", upload: bomb(4000, 4001), want: ErrDimensions},
	} {
		t.Run(test.name, func(t *testing.T) {
			if _, err := Process(test.upload); !errors.Is(err, test.want) {
				t.Fatalf("Process() error = %v, want %v", err, test.want)
			}
		})
	}
}
