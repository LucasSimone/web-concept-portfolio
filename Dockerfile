FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# .git is excluded from the build context, so the commit that every
# stamped script records (see JSPRINT_KEY in cmd/server/main.go) has to be
# passed in: docker build --build-arg BUILD_COMMIT=$(git rev-parse HEAD) .
ARG BUILD_COMMIT=""
RUN CGO_ENABLED=0 go build -ldflags "-X main.buildCommit=${BUILD_COMMIT}" -o /out/server ./cmd/server

FROM alpine:3.20
RUN adduser -D -u 10001 app && mkdir /data && chown app:app /data
COPY --from=build /out/server /app/server
USER app
WORKDIR /app
ENV PORT=8080 DB_PATH=/data/contact.db
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:8080/healthz || exit 1
ENTRYPOINT ["/app/server"]
