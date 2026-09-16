.PHONY: start-dev

# Runs the server straight off disk (DEV=1) instead of the compiled-in
# embedded build, so editing HTML/CSS/JS under web/static shows up on
# browser refresh with no rebuild or restart.
start-dev:
	DEV=1 go run ./cmd/server
