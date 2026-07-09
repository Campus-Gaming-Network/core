FROM golang:1.21-alpine AS build

WORKDIR /src

COPY go.mod ./
RUN go mod download

COPY . ./
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/cgn-api ./cmd/api

FROM alpine:3.20 AS runner

RUN addgroup -S cgn && adduser -S cgn -G cgn
USER cgn

COPY --from=build /out/cgn-api /usr/local/bin/cgn-api

EXPOSE 8080

CMD ["cgn-api"]
