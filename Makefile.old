.PHONY: release

release:
ifndef VERSION
	$(error Usage: make release VERSION=1.2.3)
endif
	# In case of
	git push
	@echo "Updating to version $(VERSION)..."
	# Mise à jour de Cargo.toml
	# Need -i '' on macOs
	@sed -i '' -E 's/^(version = )"[^"]+"/\1"$(VERSION)"/' src-tauri/Cargo.toml
	# Mise à jour de tauri.conf.json
	@sed -i '' -E 's/("version": )"[^"]+"/\1"$(VERSION)"/' src-tauri/tauri.conf.json
	# Git commit, tag et push
	git add src-tauri/Cargo.toml src-tauri/tauri.conf.json src-tauri/Cargo.lock
	git commit -m "v $(VERSION)"
	git tag "v$(VERSION)"
	git push origin "v$(VERSION)"