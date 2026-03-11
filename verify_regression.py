import os
import sys
from core.versioning.snapshot_manager import save_snapshot, list_versions, compare_versions

# Simple mock for AI metrics
metadata = {
    "summary": "Text test",
    "intent": "Edit",
    "risk_level": "Low",
    "stability_score": 0.9,
    "semantic": {}
}

test_file = "test_regression.txt"
content1 = "Hello World\nLine 2"
content2 = "Hello World\nLine 2 updated"

print("--- Testing Text Regression ---")
save_snapshot(test_file, content1, metadata)
v2_id = save_snapshot(test_file, content2, metadata)

versions = list_versions(test_file)
if len(versions) >= 2:
    v1 = versions[1]["version_id"]
    v2 = versions[0]["version_id"]
    print(f"Comparing {v1} and {v2}")
    result = compare_versions(test_file, v1, v2)
    print("Diff Result:")
    print(result["diff"])
    if "Line 2 updated" in result["diff"]:
        print("SUCCESS: Text diff working correctly.")
    else:
        print("FAILURE: Text diff not as expected.")
else:
    print("FAILURE: Not enough versions found.")
