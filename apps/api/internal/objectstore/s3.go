// Package objectstore writes public objects to Cloudflare R2, or to any
// S3-compatible endpoint such as the local MinIO service.
package objectstore

import (
	"bytes"
	"context"
	"fmt"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

type Config struct {
	// Endpoint overrides the R2 endpoint derived from AccountID; it is used for
	// local S3-compatible storage only.
	Endpoint        string
	AccountID       string
	Bucket          string
	AccessKeyID     string
	SecretAccessKey string
}

type S3Store struct {
	client *s3.Client
	bucket string
}

func NewS3Store(config Config) *S3Store {
	endpoint := config.Endpoint
	if endpoint == "" {
		endpoint = fmt.Sprintf("https://%s.r2.cloudflarestorage.com", config.AccountID)
	}
	credentials := aws.Credentials{AccessKeyID: config.AccessKeyID, SecretAccessKey: config.SecretAccessKey}
	client := s3.New(s3.Options{
		Region:       "auto",
		BaseEndpoint: aws.String(strings.TrimRight(endpoint, "/")),
		UsePathStyle: true,
		Credentials: aws.CredentialsProviderFunc(func(context.Context) (aws.Credentials, error) {
			return credentials, nil
		}),
		// R2 rejects some of the SDK's newer default checksum headers.
		RequestChecksumCalculation: aws.RequestChecksumCalculationWhenRequired,
		ResponseChecksumValidation: aws.ResponseChecksumValidationWhenRequired,
	})
	return &S3Store{client: client, bucket: config.Bucket}
}

// Put stores an immutable public object. Keys are never reused, so the object
// may be cached indefinitely.
func (store *S3Store) Put(ctx context.Context, key, contentType string, body []byte) error {
	_, err := store.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:        aws.String(store.bucket),
		Key:           aws.String(key),
		Body:          bytes.NewReader(body),
		ContentLength: aws.Int64(int64(len(body))),
		ContentType:   aws.String(contentType),
		CacheControl:  aws.String("public, max-age=31536000, immutable"),
	})
	return err
}

// Delete removes an object; deleting a missing key succeeds.
func (store *S3Store) Delete(ctx context.Context, key string) error {
	_, err := store.client.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: aws.String(store.bucket), Key: aws.String(key)})
	return err
}
