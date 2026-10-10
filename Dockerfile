FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /out/server ./cmd/server

FROM alpine:3.20
RUN adduser -D -u 10001 app && mkdir /data && chown app:app /data
COPY --from=build /out/server /app/server
USER app
WORKDIR /app
ENV PORT=8080 DB_PATH=/data/contact.db

# /data holds the SQLite database with every form submission, and since
# the admin portal (/admin) is now the way those get read, it is the only
# state here worth keeping.
#
# VOLUME alone is not enough for that: a plain `docker run` gives it an
# ANONYMOUS volume, which is orphaned and effectively lost the next time
# the container is recreated. Run it with a real mount instead, one
# directory per site:
#
#   docker run -v /srv/<site>/data:/data ...
#
# and back it up with `sqlite3 contact.db ".backup out.db"` rather than
# copying the file, which can catch a write mid-flight.
VOLUME /data

# Set ADMIN_PASSWORD_HASH (see `make admin-password`) to enable the admin
# portal. It is deliberately not set here: with it unset the server
# serves 404s at /admin rather than an unprotected inbox, so a baked-in
# default would be the one value worth never shipping in an image.
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:8080/healthz || exit 1
ENTRYPOINT ["/app/server"]
