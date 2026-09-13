# Predicate and unit registry

Every normalized assertion uses a registered predicate defining value type, canonical unit, permitted context, source mappings and aggregation rules.

Initial predicates include:

```text
life_cycle
growth_habit
mature_height
mature_spread
sun_requirement
soil_texture
soil_ph_range
drainage_requirement
water_requirement
frost_sensitivity
minimum_germination_temperature
germination_profile
growing_temperature
germination_days
days_to_first_harvest
spacing
sowing_window
transplant_window
harvest_window
growing_degree_days
```

Store numeric values with explicit units. Keep qualitative values when conversion is not defensible. Never infer a range from a category alone.

## Temperature profiles

Temperature values use a structured profile with a UCUM unit and any source-supported bounds:

```json
{ "unit": "Cel", "minimum": 10, "maximum": 30, "optimum": 24 }
```

The object may contain `minimum`, `maximum` and/or `optimum`; a missing member is unknown and must not be inferred. When both bounds and an optimum are present, the optimum must lie inside the bounds. GROW's optimum germination temperature field may report a scalar optimum or a range described as its optimum band. The ideal growing-temperature range is the reported ideal band, not an absolute survival range. GROW temperatures are normalized to Celsius under the reviewed source-specific mapping and retain the exact original source value in provenance.

Germination duration is conditional on the reported germination temperature. Store the two together as `germination_profile` when either component is known; durations use UCUM day unit `d`. Do not publish an unqualified germination duration when its source specifies an optimum temperature.
