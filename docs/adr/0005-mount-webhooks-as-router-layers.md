# Mount Webhooks as router Layers

`Telegram.Webhook(Bot, { origin, path })` returns the complete Effect `HttpRouter`
route Layer and uses the same location to reconcile Telegram's webhook URL at
deploy time.
The handler awaits update processing: successful handling returns 200, invalid
authentication returns 401, invalid input returns 400, and handler failure
returns 500 so Telegram can retry. Callers must supply the public origin as a
plan-resolvable literal, Config value, or Alchemy Output; the package combines
it with the route path but never discovers a host URL automatically. Alchemy
`2.0.0-beta.74` exposes `Cloudflare.Worker.URL` only through a runtime-deferred
accessor, so it cannot provide the plan-time Telegram registration URL.
Destroying the Webhook removes Telegram registration without dropping pending
updates.
