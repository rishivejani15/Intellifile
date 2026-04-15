import sys
import os

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from core.versioning.risk_analyzer import analyze_semantics

def run_test():
    old_code = """def hello_world():
    print("Hello world")
    return True
"""
    new_code_modified = """def hello_world():
    print("Goodbye world")
    return False
"""
    
    print("TEST 1: Modification Scoring & Cached Execution")
    res1 = analyze_semantics(old_code, new_code_modified, diff_text="""
@@ -1,3 +1,3 @@
 def hello_world():
-    print("Hello world")
-    return True
+    print("Goodbye world")
+    return False
""")
    print(res1)
    
    # We replaced 2 lines with 2 new lines.
    # The modifying lines count should correctly calculate a modification score.
    assert res1["modify_score"] > 0, "Modify score should be greater than zero for replaced lines."
    assert res1["intent"] == "Addition/Modification", f"Expected Addition/Modification intent, got {res1['intent']}"
    assert res1["risk_score"] >= 0.0 and res1["risk_score"] <= 1.0, "Risk score must be normalized between 0 and 1"
    assert res1["block_score"] >= 0.0, "Block score must be populated."
    print("Test 1 Passed!\n")

    print("\nTEST 2: Block Detection Scoring")
    old_blocks = "\n".join([f"line {i}" for i in range(20)])
    new_blocks = "\n".join([f"line {i}" for i in range(10)]) + "\n" + "\n".join([f"NEW LINE {i}" for i in range(10)])
    
    res2 = analyze_semantics(old_blocks, new_blocks) 
    print(res2)
    assert res2["block_score"] > 0, "Chunk modifications should yield a block score."
    assert res2["similarity_score"] > 0, "Similarity should be factored by total lines."
    assert res2["intent"] == "Deletion Heavy" or res2["intent"] == "Addition/Modification"
    print("Test 2 Passed!\n")

if __name__ == "__main__":
    run_test()
