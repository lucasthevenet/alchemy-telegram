# Publish two packages in lockstep

Publish `distilled-telegram` as a complete, independently useful Effect SDK and
`alchemy-telegram` as the Alchemy provider built on it. Release both packages
in lockstep initially so the provider's generated types and protocol assumptions
always identify one unambiguous SDK version; independent versioning can be
introduced after the SDK contract stabilizes. Both packages begin at `0.1.0`;
dependency versions do not determine this project's package version.
