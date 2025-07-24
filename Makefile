tunnel:
	@cloudflared tunnel --config tunnel-config.yml run

tunnel-bg:
	@cloudflared tunnel --config tunnel-config.yml run &

tunnel-stop:
	@pkill cloudflared || true

tunnel-restart: tunnel-stop
	@sleep 2
	@cloudflared tunnel --config tunnel-config.yml run &

.PHONY: tunnel tunnel-bg tunnel-stop tunnel-restart