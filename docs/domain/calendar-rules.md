# Cultivation rules

A cultivation rule is a reviewed, evidence-backed parameter for one action, subject and context. It is
not a current recommendation. A rule never substitutes a missing date, temperature, anchor, context or
observation with a guessed value.

The V1 action registry is fixed:

- `start_indoors`
- `direct_sow`
- `transplant`
- `plant`
- `harvest`
- `establish_outdoors`

Timing is one of five explicitly typed forms:

- `calendar-month-window`: start and end months;
- `calendar-date-window`: start and end month/day pairs, without a year;
- `relative-day-window`: integer offsets from last spring frost, first autumn frost or previous crop
  harvest;
- `soil-temperature-threshold`: at-least, at-most or between temperatures in `Cel`, with optional
  measurement depth, period and aggregation;
- `growing-degree-day-threshold`: threshold in `Cel.d`, explicit base temperature in `Cel`, fixed
  `daily-mean` method and stated accumulation anchor.

Calendar-month and calendar-date windows remain different values. Start/end order may describe a window
crossing year-end. Validation must reject impossible month/day pairs (including February 30), even though
JSON Schema alone checks only the individual month and day ranges. GDD method is not guessed from a source;
the V1 supported method is only `daily-mean`.

Rules retain plant-concept, cultivar-group or cultivar scope. A selected cultivar automatically receives
eligible parent rules unless a cultivar rule explicitly lists a parent rule in `supersedesRuleIds`; absent
that declaration, the parent rule remains available alongside the child rule. Hortinis combines applicable
parameters with garden state and observations, explains limitations and decides when to abstain.
