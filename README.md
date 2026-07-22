# README

A simple graph-based web visualization tool for the O'Keefe family tree.

## Data Schema
In `family_tree.json`, metadata fields adhere to standardized formats:
- **birthday**: Optional string standardized to ISO 8601 (`YYYY-MM-DD`) date format when known (e.g., `"1990-04-15"`).
- **birth_location** & **residence_location**: Structured objects representing country/town pairs containing optional `"country"` and `"town"` fields (e.g., `{"country": "Canada", "town": "St. John's"}`).
