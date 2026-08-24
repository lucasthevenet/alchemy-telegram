# Treat the authenticated Bot ID as invariant

Verify every Bot token with `getMe` and persist the resulting Telegram Bot ID as
the Bot Application's remote identity. Accept token rotation when the ID is
unchanged, but fail deployment when a new token identifies another Bot; users
must destroy the old configuration with its old credential before explicitly
retargeting, preventing silently abandoned configuration.

