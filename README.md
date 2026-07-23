# README

A simple graph-based web visualization tool for the O'Keefe family tree.

## Data Schema
The `family_tree.json` dataset is structured as a normalized object with two root registries:
- **places**: A dictionary mapping location slug IDs (e.g., `"loc-st-johns"`, `"loc-ottawa"`) to standardized country/town pair objects (`{"country": "Canada", "town": "St. John's"}`).
- **people**: An array of person records with structured naming and location references. To minimize file clutter, optional fields with null values may be omitted entirely:
  - **Required Fields**: Every record must contain valid non-null values for `id`, `first_name`, `last_name`, and `gender` (`"M"` or `"F"`).
  - **Optional Fields**: All other properties (`middle_names`, `nickname`, `mother`, `father`, and `meta` attributes such as `birth_location_id`, `residence_location_id`, `birth_year`, and `birthday`) are optional and should be excluded when unrecorded.

## Development & Validation
To preserve dataset consistency, a validation script ([validate_tree.py](file:///home/zokeefe/proj/okeefe/validate_tree.py)) checks relational integrity, lifespan rules, ISO dates, and location foreign keys.

To activate automated validation before every commit, configure Git to use the repository's version-controlled hooks directory:
```bash
git config core.hooksPath .githooks
```
Once activated, Git will run `validate_tree.py` automatically during `git commit` and abort any changes that introduce semantic or formatting errors.
