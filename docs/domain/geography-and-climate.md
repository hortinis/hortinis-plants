# Geography and climate

The initial catalog targets metropolitan France, including Corsica and excluding overseas territories.
The catalog uses stable semantic geographic-context records with explicit kind, name, parent IDs and
evidence. A cultivation context refers to one or more of those IDs or explicitly declares geographic
scope unknown.

Semantic hierarchy does not imply coordinates, borders, polygon containment, climate classification or
source applicability. Store a parent relationship only when supported. Retain source-specific locations
and strata as source provenance rather than automatically converting them to a Hortinis region.

This catalog contract carries no polygons, climate cells, forecast, garden microclimate or current frost
observations. Static climate-grid data is planned as an independently versioned artifact in a separate
`hortinis-climate` repository. Hortinis owns dynamic weather and garden observations; catalog rules may
refer only to explicit semantic contexts and source-backed static requirements.
