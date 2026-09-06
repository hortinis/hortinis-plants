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
germination_days
days_to_first_harvest
spacing
sowing_window
transplant_window
harvest_window
growing_degree_days
```

Store numeric values with explicit units. Keep qualitative values when conversion is not defensible. Never infer a range from a category alone.
