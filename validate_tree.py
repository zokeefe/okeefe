#!/usr/bin/env python3
import sys
import json
import re
from pathlib import Path

def validate_family_tree(json_path="family_tree.json"):
    path = Path(json_path)
    if not path.exists():
        print(f"ERROR: File not found: {json_path}")
        return False
    
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        print(f"ERROR: Failed to parse JSON from {json_path}: {e}")
        return False

    if isinstance(data, dict):
        places = data.get("places", {})
        people_list = data.get("people", [])
    elif isinstance(data, list):
        places = {}
        people_list = data
    else:
        print("ERROR: Top-level JSON data must be an object with 'places' and 'people', or an array.")
        return False

    errors = []
    warnings = []
    people_map = {}
    
    if not isinstance(places, dict):
        errors.append("Top-level 'places' property must be a dictionary.")
        places = {}
    else:
        for loc_id, loc_val in places.items():
            if not isinstance(loc_val, dict):
                errors.append(f"Place ID '{loc_id}' must be a dictionary with country/town pairs.")
            else:
                invalid_keys = set(loc_val.keys()) - {"country", "town"}
                if invalid_keys:
                    warnings.append(f"Place ID '{loc_id}' contains unexpected keys: {invalid_keys}.")
    
    required_keys = {"id", "name", "mother", "father", "gender", "meta"}

    # Pass 1: Syntax, ID uniqueness, and indexing
    for i, p in enumerate(people_list):
        if not isinstance(p, dict):
            errors.append(f"Index {i}: Entry is not a JSON object.")
            continue
        
        missing_keys = required_keys - p.keys()
        if missing_keys:
            errors.append(f"Index {i}: Missing required keys: {missing_keys}")

        pid = p.get("id")
        if not pid or not isinstance(pid, str):
            errors.append(f"Index {i}: Invalid or missing 'id' string: {pid}")
            continue
        
        if pid in people_map:
            errors.append(f"Duplicate ID detected: '{pid}' assigned to multiple entries.")
        else:
            people_map[pid] = p

        # Check gender validity
        gender = p.get("gender")
        if gender not in {"M", "F", None}:
            errors.append(f"ID '{pid}': Invalid gender '{gender}'. Must be 'M', 'F', or null.")

    # Pass 2: Relational and semantic constraints
    for pid, p in people_map.items():
        name = p.get("name", pid)
        meta = p.get("meta", {})
        
        # Check mother reference
        mother_id = p.get("mother")
        if mother_id is not None:
            if mother_id == pid:
                errors.append(f"ID '{pid}' ({name}): Person cannot be their own mother.")
            elif mother_id not in people_map:
                errors.append(f"ID '{pid}' ({name}): Mother ID '{mother_id}' does not exist in dataset.")
            else:
                mother_person = people_map[mother_id]
                if mother_person.get("gender") != "F":
                    errors.append(f"ID '{pid}' ({name}): Mother ID '{mother_id}' ({mother_person.get('name')}) has gender '{mother_person.get('gender')}', expected 'F'.")
        
        # Check father reference
        father_id = p.get("father")
        if father_id is not None:
            if father_id == pid:
                errors.append(f"ID '{pid}' ({name}): Person cannot be their own father.")
            elif father_id not in people_map:
                errors.append(f"ID '{pid}' ({name}): Father ID '{father_id}' does not exist in dataset.")
            else:
                father_person = people_map[father_id]
                if father_person.get("gender") != "M":
                    errors.append(f"ID '{pid}' ({name}): Father ID '{father_id}' ({father_person.get('name')}) has gender '{father_person.get('gender')}', expected 'M'.")
        
        # Lifespan sanity check
        birth_year = meta.get("birth_year")
        death_year = meta.get("death_year")
        if birth_year is not None and death_year is not None:
            if not isinstance(birth_year, int) or not isinstance(death_year, int):
                errors.append(f"ID '{pid}': birth_year and death_year must be integers.")
            elif birth_year > death_year:
                errors.append(f"ID '{pid}' ({name}): Invalid lifespan, birth_year ({birth_year}) is greater than death_year ({death_year}).")
            elif (death_year - birth_year) > 125:
                warnings.append(f"ID '{pid}' ({name}): Unusual lifespan duration ({death_year - birth_year} years).")

        # Parent age consistency
        for parent_label, parent_id in [("Mother", mother_id), ("Father", father_id)]:
            if parent_id and parent_id in people_map and birth_year is not None:
                parent_birth = people_map[parent_id].get("meta", {}).get("birth_year")
                if parent_birth is not None and isinstance(parent_birth, int) and isinstance(birth_year, int):
                    if parent_birth >= birth_year:
                        errors.append(f"ID '{pid}' ({name}): {parent_label} ({parent_id}) birth year ({parent_birth}) must be earlier than child birth year ({birth_year}).")
                    elif (birth_year - parent_birth) < 12:
                        warnings.append(f"ID '{pid}' ({name}): {parent_label} ({parent_id}) was unusually young ({birth_year - parent_birth} years old) at child's birth.")
        
        # Birthday ISO format check
        birthday = meta.get("birthday")
        if birthday is not None:
            if not isinstance(birthday, str) or not re.match(r"^\d{4}-\d{2}-\d{2}$", birthday):
                errors.append(f"ID '{pid}' ({name}): 'birthday' ({birthday}) must be formatted as an ISO 8601 date string 'YYYY-MM-DD'.")
        
        # Location structure check (supports both normalized ID references and inline objects)
        for loc_key in ["birth_location", "residence_location"]:
            loc_id = meta.get(f"{loc_key}_id")
            if loc_id is not None:
                if not isinstance(loc_id, str):
                    errors.append(f"ID '{pid}' ({name}): '{loc_key}_id' must be a string referencing a place ID.")
                elif loc_id not in places:
                    errors.append(f"ID '{pid}' ({name}): Referenced '{loc_key}_id' ('{loc_id}') does not exist in 'places' registry.")

            loc_val = meta.get(loc_key)
            if loc_val is not None:
                if not isinstance(loc_val, dict):
                    errors.append(f"ID '{pid}' ({name}): '{loc_key}' must be a dictionary with country/town pairs.")
                else:
                    invalid_keys = set(loc_val.keys()) - {"country", "town"}
                    if invalid_keys:
                        warnings.append(f"ID '{pid}' ({name}): '{loc_key}' contains unexpected keys: {invalid_keys}.")

    # Pass 3: Cycle detection (DFS)
    visited = set()
    visiting = set()
    
    def check_cycle(curr_id, path_stack):
        if curr_id in visiting:
            cycle_path = " -> ".join(path_stack + [curr_id])
            errors.append(f"Lineage cycle detected: {cycle_path}")
            return
        if curr_id in visited or curr_id not in people_map:
            return
        visiting.add(curr_id)
        path_stack.append(curr_id)
        
        p = people_map[curr_id]
        if p.get("mother"):
            check_cycle(p.get("mother"), path_stack)
        if p.get("father"):
            check_cycle(p.get("father"), path_stack)
            
        path_stack.pop()
        visiting.remove(curr_id)
        visited.add(curr_id)

    for pid in people_map:
        check_cycle(pid, [])

    # Summary Output
    print("=== Family Tree Validation Summary ===")
    print(f"Dataset File      : {json_path}")
    print(f"Places Registered : {len(places)}")
    print(f"Total Individuals : {len(people_list)}")
    print(f"Unique IDs Checked: {len(people_map)}")
    
    if warnings:
        print(f"\nWarnings ({len(warnings)}):")
        for w in warnings:
            print(f"  [WARN] {w}")

    if errors:
        print(f"\nErrors ({len(errors)}):")
        for e in errors:
            print(f"  [ERROR] {e}")
        print("\n❌ Validation FAILED.")
        return False
    
    print("✅ All validation checks passed successfully!")
    return True

if __name__ == "__main__":
    file_path = sys.argv[1] if len(sys.argv) > 1 else "family_tree.json"
    success = validate_family_tree(file_path)
    sys.exit(0 if success else 1)
