import sys
import os

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from core.versioning.risk_analyzer import analyze_semantics

def run_test():
    old_code = """
def hello_world():
    print("Hello world")
    return True
"""
    new_code_heavy_addition = """
def hello_world():
    print("Hello world")
    return True
    
def new_complex_function(data: dict) -> list:
    import json
    import re
    # heavily formatted tokens and symbols
    parsed = json.loads(data.get("body", "{}"))
    return [re.sub(r'[^a-zA-Z]', '', x) for x in parsed.values()]
"""
    new_code_deletion = """
def hello_world():
    pass
"""
    
    print("TEST 1: Heavy Addition vs Old Code (Testing addition > deletion rules)")
    res1 = analyze_semantics(old_code, new_code_heavy_addition, diff_text="""
@@ -1,3 +1,11 @@
 def hello_world():
     print("Hello world")
     return True
+    
+def new_complex_function(data: dict) -> list:
+    import json
+    import re
+    # heavily formatted tokens and symbols
+    parsed = json.loads(data.get("body", "{}"))
+    return [re.sub(r'[^a-zA-Z]', '', x) for x in parsed.values()]
""")
    print(res1)
    assert res1["intent"] == "Addition/Modification", f"Expected Addition/Modification intent, got {res1['intent']}"
    assert res1["add_score"] > res1["delete_score"], "Add score should exceed delete score"
    print("Test 1 Passed!\n")

    print("TEST 2: Heavy Deletion vs Old Code (Testing delete > add rules)")
    res2 = analyze_semantics(old_code, new_code_deletion, diff_text="""
@@ -1,3 +1,2 @@
 def hello_world():
-    print("Hello world")
-    return True
+    pass
""")
    print(res2)
    assert res2["intent"] == "Deletion Heavy", f"Expected Deletion Heavy intent, got {res2['intent']}"
    assert res2["delete_score"] > res2["add_score"], "Delete score should exceed add score"
    print("Test 2 Passed!\n")


if __name__ == "__main__":
    run_test()
