# Manage only declared Bot Configuration

Treat never-declared Bot Configuration as unmanaged, but reset a previously
managed value when it is removed from the Bot Application. This permits partial
adoption while ensuring configuration does not outlive its declaration; the Bot
Profile groups default and localized text, while profile photos remain outside
V1. Profile and Command Set declarations claim their existing settings directly,
while an existing non-empty Webhook pointing elsewhere and future independently
deletable objects require explicit Alchemy adoption.
