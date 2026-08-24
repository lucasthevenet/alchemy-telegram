# Use Effect services without a Bot middleware pipeline

Use Effect Layers and services as the Bot Application's sole dependency and
extension model rather than introducing a separate ordered GramIO-style
middleware pipeline. Update filtering, guards, enrichment, error handling, and
observability compose as Effects and services, keeping one execution model and
preserving handler requirements in the Effect type. Dispatch is exclusive and
deterministic: `Command`, `Hears`, and `CallbackQuery` handlers take precedence
over one typed `On` fallback, duplicate handlers at the same specificity fail,
and every handler receives an immutable Handler Context. Specialized overlaps
use sequential declaration order, callback-query handlers auto-answer after
successful handling unless disabled, and `On` uses Telegram Update field names
with `"*"` as the forward-compatible fallback.
