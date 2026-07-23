# README

A simple graph-based web visualization tool for the O'Keefe family tree.

## Data Schema
The `family_tree.json` dataset is structured as a normalized object with two root registries:
- **places**: A dictionary mapping location slug IDs (e.g., `"loc-st-johns"`, `"loc-ottawa"`) to standardized country/town pair objects (`{"country": "Canada", "town": "St. John's"}`).
- **people**: An array of person records with structured naming and location references:
  - **first_name**, **middle_names**, & **last_name**: Separated name string components (`middle_names` is optional and set to `null` when missing).
  - **birth_location_id** & **residence_location_id**: Optional string referencing a valid place ID in `places`.
  - **birthday**: Optional string standardized to ISO 8601 (`YYYY-MM-DD`) date format when known (e.g., `"1990-04-15"`).

## Development & Validation
To preserve dataset consistency, a validation script ([validate_tree.py](file:///home/zokeefe/proj/okeefe/validate_tree.py)) checks relational integrity, lifespan rules, ISO dates, and location foreign keys.

To activate automated validation before every commit, configure Git to use the repository's version-controlled hooks directory:
```bash
git config core.hooksPath .githooks
```
Once activated, Git will run `validate_tree.py` automatically during `git commit` and abort any changes that introduce semantic or formatting errors.
