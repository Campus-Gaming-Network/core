FROM golang:1.27.2-alpine3.24 AS build

WORKDIR /src

COPY apps/api/go.mod apps/api/go.sum ./
RUN go mod download

COPY apps/api/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/cgn-api ./cmd/api \
    && CGO_ENABLED=0 GOOS=linux go build -o /out/cgn-migrate ./cmd/migrate \
    && CGO_ENABLED=0 GOOS=linux go build -o /out/cgn-seed ./cmd/seed \
    && CGO_ENABLED=0 GOOS=linux go build -o /out/cgn-admin ./cmd/cgn-admin

FROM alpine:3.24 AS runner

ENV DEPLOYMENT_ENV=production

RUN apk add --no-cache ca-certificates \
    && addgroup -S cgn \
    && adduser -S cgn -G cgn
USER cgn

# One copy, one layer: each layer costs time to export and push.
COPY --from=build /out/ /usr/local/bin/
COPY db/migrations /migrations
COPY data/schools_seed.csv /data/schools_seed.csv

EXPOSE 8080

CMD ["cgn-api"]
