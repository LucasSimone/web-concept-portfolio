.PHONY: start-dev stop-dev

# Runs the server straight off disk (DEV=1) instead of the compiled-in
# embedded build, so editing HTML/CSS/JS under web/static shows up on
# browser refresh with no rebuild or restart.
start-dev:
	DEV=1 go run ./cmd/server

# Kills whatever is listening on the dev server's port - handy when it was
# left running in the background (or from another session) instead of
# stopped with Ctrl+C.
stop-dev:
	@pid=$$(lsof -tiTCP:8080 -sTCP:LISTEN); \
	if [ -n "$$pid" ]; then \
		kill $$pid && echo "Stopped dev server (pid $$pid)"; \
	else \
		echo "No dev server running on :8080"; \
	fi
