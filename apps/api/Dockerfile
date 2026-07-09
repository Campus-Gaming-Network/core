FROM golang:1.21-alpine AS build

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . ./
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/cgn-api ./cmd/api \
    && CGO_ENABLED=0 GOOS=linux go build -o /out/cgn-migrate ./cmd/migrate \
    && CGO_ENABLED=0 GOOS=linux go build -o /out/cgn-seed ./cmd/seed

FROM alpine:3.20 AS runner

RUN addgroup -S cgn && adduser -S cgn -G cgn
USER cgn

COPY --from=build /out/cgn-api /usr/local/bin/cgn-api
COPY --from=build /out/cgn-migrate /usr/local/bin/cgn-migrate
COPY --from=build /out/cgn-seed /usr/local/bin/cgn-seed

EXPOSE 8080

CMD ["cgn-api"]
