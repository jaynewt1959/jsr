# JSR — build and deploy to iPad
#
# Usage:
#   make          → build web + install on iPad  (default)
#   make web      → build React app only
#   make ios      → build + install iOS app only
#   make launch   → launch app on iPad after installing
#   make deploy   → web + ios + launch (full pipeline)

DEVICE_ID   := 97897000-704D-5A76-8FBF-87E678C40D4B
BUNDLE_ID   := com.jamien.JSR
PROJECT     := JSR.xcodeproj
SCHEME      := JSR
DESTINATION := platform=iOS,id=$(DEVICE_ID)

.DEFAULT_GOAL := install

# ── Web build ──────────────────────────────────────────────────────────────

.PHONY: web
web:
	@echo "→ Building web layer…"
	cd web && npm run build
	@echo "✓ Web build done"

# ── iOS build + install ────────────────────────────────────────────────────

.PHONY: ios
ios:
	@echo "→ Building and installing iOS app on iPad…"
	xcrun xcodebuild \
		-project $(PROJECT) \
		-scheme  $(SCHEME) \
		-destination "$(DESTINATION)" \
		-configuration Debug \
		-allowProvisioningUpdates \
		build
	@echo "✓ iOS build done"

# ── Launch app on device ───────────────────────────────────────────────────

.PHONY: launch
launch:
	@echo "→ Launching $(BUNDLE_ID) on iPad…"
	xcrun devicectl device process launch \
		--device $(DEVICE_ID) \
		$(BUNDLE_ID) || true
	@echo "✓ Launched"

# ── Combined targets ───────────────────────────────────────────────────────

.PHONY: install
install: web ios
	@echo ""
	@echo "✓ JSR installed on iPad. Tap the icon to open."

.PHONY: deploy
deploy: web ios launch
	@echo ""
	@echo "✓ JSR deployed and launched on iPad."
