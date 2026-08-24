# Bind Bot tokens from Effect Config

Each Bot Application receives its token through an Effect `Config.Redacted`
source that Alchemy resolves into the host's secret binding. Token material is
never included in resource props or attributes, allowing multiple Bot
Applications while avoiding plaintext secrets in Alchemy state.
