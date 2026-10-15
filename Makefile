# Release.
#
#   make release 1.0.4          (or: make release VERSION=1.0.4)
#
# Writes the version into src-tauri/Cargo.toml and src-tauri/tauri.conf.json,
# refreshes Cargo.lock, commits, pushes, then tags and pushes the tag -- which
# is what the GitHub workflow watches for.

# The version may come as a goal on the command line or as VERSION=.
VERSION ?= $(strip $(filter-out release,$(MAKECMDGOALS)))

CARGO_TOML := src-tauri/Cargo.toml
TAURI_CONF := src-tauri/tauri.conf.json

# `sed -i` is spelled differently on macOS and on GNU, and `0,/re/` is a GNU
# extension: awk replaces only the first match and behaves the same everywhere.
define set_toml_version
	awk -v v='$(VERSION)' 'BEGIN{d=0} !d && /^version[ \t]*=[ \t]*"/ {sub(/"[^"]*"/, "\"" v "\""); d=1} {print}' \
		$(CARGO_TOML) > $(CARGO_TOML).tmp && mv $(CARGO_TOML).tmp $(CARGO_TOML)
endef

define set_json_version
	awk -v v='$(VERSION)' 'BEGIN{d=0} !d && /"version"[ \t]*:/ {sub(/:[ \t]*"[^"]*"/, ": \"" v "\""); d=1} {print}' \
		$(TAURI_CONF) > $(TAURI_CONF).tmp && mv $(TAURI_CONF).tmp $(TAURI_CONF)
endef

.PHONY: release version check-release

version:
	@grep -m1 '^version' $(CARGO_TOML)
	@grep -m1 '"version"' $(TAURI_CONF)

check-release:
	@test -n '$(VERSION)' || { echo 'Usage: make release 1.0.4'; exit 1; }
	@echo '$(VERSION)' | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.]+)?$$' \
		|| { echo 'Not a version number: $(VERSION)'; exit 1; }
	@git rev-parse -q --verify 'refs/tags/v$(VERSION)' >/dev/null \
		&& { echo 'Tag v$(VERSION) already exists.'; exit 1; } || true
	@test -z "$$(git status --porcelain -- $(CARGO_TOML) $(TAURI_CONF))" \
		|| { echo 'The version files already have uncommitted changes; sort them out first.'; exit 1; }

release: check-release
	@echo '==> version $(VERSION)'
	@$(set_toml_version)
	@$(set_json_version)
	@# Keep Cargo.lock in step: a build with --locked fails on a stale one.
	@cd src-tauri && cargo update -p MystralEditor --offline >/dev/null 2>&1 \
		|| cargo update -p MystralEditor >/dev/null 2>&1 || true
	@$(MAKE) --no-print-directory version
	git add $(CARGO_TOML) $(TAURI_CONF) src-tauri/Cargo.lock
	git commit -m 'v$(VERSION)'
	git push
	git tag 'v$(VERSION)'
	git push origin 'v$(VERSION)'
	@echo '==> v$(VERSION) pushed; the release workflow takes it from here.'

# `make release 1.0.4` hands make a second goal named 1.0.4. Swallow it, but
# only during a release, so that a mistyped target elsewhere still complains.
ifneq (,$(filter release,$(MAKECMDGOALS)))
%:
	@:
endif
