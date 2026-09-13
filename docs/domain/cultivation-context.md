# Cultivation context

Every cultivation claim names a reusable context describing where and under what conditions it applies.
Context IDs are stable. A context may specify one or more geographic-context IDs or explicitly state that
geographic scope is unknown.

Supported dimensions are:

- semantic geography (catalog scope, administrative area, source location or climate region);
- growing system: outdoor, unheated shelter, heated greenhouse, indoor or unknown;
- propagation: direct sowing, transplant, vegetative, the source-native combined
  `direct_sowing_or_transplant`, or unknown;
- optional life stage, soil/container, irrigation and protection.

The schema intentionally contains no coordinates, polygons, climate cells or dynamic weather data.
Geographic parentage and evidence are records in their own right; it does not imply containment beyond
the explicitly stored links. Missing dimensions stay absent or explicitly unknown. Never present a broad
source claim as France-specific, cultivar-specific or system-specific without evidence.
