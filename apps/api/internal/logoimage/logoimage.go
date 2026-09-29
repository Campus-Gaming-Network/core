// Package logoimage validates an uploaded school logo and re-encodes it so only
// server-produced pixels are ever stored. The client's filename and MIME type
// are never consulted: the decision rests on the bytes alone.
package logoimage

import (
	"bytes"
	"encoding/binary"
	"errors"
	"image"
	"image/jpeg"
	"image/png"

	"golang.org/x/image/draw"
)

const (
	// MaxBytes is the encoded upload limit.
	MaxBytes = 5 << 20
	// MaxSide and MaxPixels bound the decoded image before any full decode.
	MaxSide   = 4096
	MaxPixels = 16_000_000
	// OutputSide is the longest side of the stored logo; logos render small.
	OutputSide = 512
)

var (
	ErrTooLarge    = errors.New("logo exceeds the upload size limit")
	ErrUnsupported = errors.New("logo is not a single-frame PNG or JPEG")
	ErrInvalid     = errors.New("logo is malformed or carries extra content")
	ErrDimensions  = errors.New("logo exceeds the dimension or pixel limit")
)

// Image is a re-encoded logo that is safe to publish.
type Image struct {
	Body        []byte
	ContentType string
	Extension   string
}

var pngSignature = []byte("\x89PNG\r\n\x1a\n")

// Process accepts a complete upload of at most MaxBytes and returns a
// re-encoded PNG (for PNG input) or JPEG (for JPEG input) without metadata.
func Process(data []byte) (Image, error) {
	if len(data) > MaxBytes {
		return Image{}, ErrTooLarge
	}
	isPNG := bytes.HasPrefix(data, pngSignature)
	orientation := 1
	var err error
	switch {
	case isPNG:
		err = checkPNG(data)
	case bytes.HasPrefix(data, []byte{0xFF, 0xD8, 0xFF}):
		orientation, err = checkJPEG(data)
	default:
		return Image{}, ErrUnsupported
	}
	if err != nil {
		return Image{}, err
	}

	decodeConfig, decode := jpeg.DecodeConfig, jpeg.Decode
	if isPNG {
		decodeConfig, decode = png.DecodeConfig, png.Decode
	}
	config, err := decodeConfig(bytes.NewReader(data))
	if err != nil {
		return Image{}, ErrInvalid
	}
	if config.Width < 1 || config.Height < 1 || config.Width > MaxSide || config.Height > MaxSide ||
		config.Width*config.Height > MaxPixels {
		return Image{}, ErrDimensions
	}
	decoded, err := decode(bytes.NewReader(data))
	if err != nil {
		return Image{}, ErrInvalid
	}

	pixels := orient(resize(decoded), orientation)
	var output bytes.Buffer
	if isPNG {
		encoder := png.Encoder{CompressionLevel: png.BestCompression}
		if err := encoder.Encode(&output, pixels); err != nil {
			return Image{}, err
		}
		return Image{Body: output.Bytes(), ContentType: "image/png", Extension: ".png"}, nil
	}
	if err := jpeg.Encode(&output, pixels, &jpeg.Options{Quality: 90}); err != nil {
		return Image{}, err
	}
	return Image{Body: output.Bytes(), ContentType: "image/jpeg", Extension: ".jpg"}, nil
}

// checkPNG walks the chunk list so animation and bytes appended after IEND
// (a common polyglot carrier) are rejected rather than silently ignored.
func checkPNG(data []byte) error {
	offset := len(pngSignature)
	for first := true; ; first = false {
		if len(data)-offset < 12 {
			return ErrInvalid
		}
		length := int(binary.BigEndian.Uint32(data[offset:]))
		kind := string(data[offset+4 : offset+8])
		if length > len(data)-offset-12 || (first && kind != "IHDR") {
			return ErrInvalid
		}
		offset += 12 + length
		switch kind {
		case "acTL", "fcTL", "fdAT":
			return ErrUnsupported
		case "IEND":
			if offset != len(data) {
				return ErrInvalid
			}
			return nil
		}
	}
}

// checkJPEG walks the marker segments to EOI, returning the EXIF orientation.
// Anything after EOI, including a second MPO frame, is rejected.
func checkJPEG(data []byte) (int, error) {
	orientation := 1
	offset := 2
	for {
		if offset >= len(data) || data[offset] != 0xFF {
			return 0, ErrInvalid
		}
		for offset < len(data) && data[offset] == 0xFF {
			offset++
		}
		if offset >= len(data) {
			return 0, ErrInvalid
		}
		marker := data[offset]
		offset++
		if marker == 0xD9 {
			if offset != len(data) {
				return 0, ErrInvalid
			}
			return orientation, nil
		}
		if marker == 0x01 || (marker >= 0xD0 && marker <= 0xD7) {
			continue
		}
		if len(data)-offset < 2 {
			return 0, ErrInvalid
		}
		length := int(binary.BigEndian.Uint16(data[offset:]))
		if length < 2 || length > len(data)-offset {
			return 0, ErrInvalid
		}
		segment := data[offset+2 : offset+length]
		offset += length
		if marker == 0xE1 && bytes.HasPrefix(segment, []byte("Exif\x00\x00")) {
			orientation = exifOrientation(segment[6:])
		}
		if marker != 0xDA {
			continue
		}
		// Skip entropy-coded data: 0xFF is followed by 0x00 (stuffing),
		// a restart marker, or the next real marker.
		for offset+1 < len(data) {
			if data[offset] == 0xFF && data[offset+1] != 0x00 && (data[offset+1] < 0xD0 || data[offset+1] > 0xD7) {
				break
			}
			offset++
		}
	}
}

// exifOrientation reads tag 0x0112 from IFD0 of a TIFF block, defaulting to
// upright when the block is absent or malformed.
func exifOrientation(tiff []byte) int {
	if len(tiff) < 8 {
		return 1
	}
	var order binary.ByteOrder
	switch string(tiff[:4]) {
	case "II*\x00":
		order = binary.LittleEndian
	case "MM\x00*":
		order = binary.BigEndian
	default:
		return 1
	}
	ifd := int(order.Uint32(tiff[4:]))
	if ifd < 8 || ifd > len(tiff)-2 {
		return 1
	}
	count := int(order.Uint16(tiff[ifd:]))
	for index := range count {
		entry := ifd + 2 + index*12
		if entry > len(tiff)-12 {
			return 1
		}
		if order.Uint16(tiff[entry:]) == 0x0112 && order.Uint16(tiff[entry+2:]) == 3 {
			if value := int(order.Uint16(tiff[entry+8:])); value >= 1 && value <= 8 {
				return value
			}
			return 1
		}
	}
	return 1
}

// resize copies the decoded pixels into a fresh NRGBA canvas, scaling so the
// longest side is at most OutputSide.
func resize(source image.Image) *image.NRGBA {
	bounds := source.Bounds()
	width, height := bounds.Dx(), bounds.Dy()
	if width > OutputSide || height > OutputSide {
		if width >= height {
			width, height = OutputSide, max(1, (height*OutputSide+width/2)/width)
		} else {
			width, height = max(1, (width*OutputSide+height/2)/height), OutputSide
		}
	}
	target := image.NewNRGBA(image.Rect(0, 0, width, height))
	draw.CatmullRom.Scale(target, target.Bounds(), source, bounds, draw.Src, nil)
	return target
}

// orient applies an EXIF orientation (1-8) so the stored pixels are upright.
func orient(source *image.NRGBA, orientation int) *image.NRGBA {
	if orientation == 1 {
		return source
	}
	width, height := source.Rect.Dx(), source.Rect.Dy()
	targetWidth, targetHeight := width, height
	if orientation >= 5 {
		targetWidth, targetHeight = height, width
	}
	target := image.NewNRGBA(image.Rect(0, 0, targetWidth, targetHeight))
	for y := range height {
		for x := range width {
			var tx, ty int
			switch orientation {
			case 2:
				tx, ty = width-1-x, y
			case 3:
				tx, ty = width-1-x, height-1-y
			case 4:
				tx, ty = x, height-1-y
			case 5:
				tx, ty = y, x
			case 6:
				tx, ty = height-1-y, x
			case 7:
				tx, ty = height-1-y, width-1-x
			default:
				tx, ty = y, width-1-x
			}
			copy(target.Pix[target.PixOffset(tx, ty):][:4], source.Pix[source.PixOffset(x, y):][:4])
		}
	}
	return target
}
