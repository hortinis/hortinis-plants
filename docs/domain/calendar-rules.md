# Calendar rules

Calendar rules describe a plant action, an anchor and a context. They do not contain a current recommendation.

Supported anchors:

- `last_spring_frost`
- `first_autumn_frost`
- `soil_temperature`
- `growing_degree_days`
- `calendar_date`
- `previous_crop_harvest`

Supported actions include `start_indoors`, `direct_sow`, `transplant`, `plant_now` and `harvest`.

Rules must retain the growing system (`outdoor`, `unheated_shelter`, `heated_greenhouse` or `indoor`), propagation method, geographic applicability and cultivar scope. Hortinis combines these parameters with current context and decides whether to recommend, abstain or request an observation.

Month-only advice is allowed as source evidence but should be normalized to an explicit calendar interval or marked as low precision.
