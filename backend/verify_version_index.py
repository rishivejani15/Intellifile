import sys
import os
import json

# Add backend to python path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from core.versioning.snapshot_manager import create_version, get_versions, get_last_version, get_file_id, get_version_index_path

def run():
    import time
    test_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), f"test_{int(time.time())}.txt")
    
    try:
        # Clear existing test index if any (to isolate test)
        index_path = get_version_index_path(test_file)
        if os.path.exists(index_path):
            os.remove(index_path)

        import time
        unique_str = f"Hello World {time.time()}\n"
        
        # 1. Create version 1
        with open(test_file, "w", encoding="utf-8") as f:
            f.write(unique_str)
            
        print("Creating version 1...")
        ts1 = create_version(test_file, unique_str, {"summary": "Initial commit"})
        
        # 2. Try to create exact same version (hash match)
        print("Creating duplicate version...")
        ts2 = create_version(test_file, unique_str, {"summary": "Forgot something"})
        if ts1 == ts2:
            print("SUCCESS: Hash check prevented duplicate version creation.")
        else:
            print(f"FAILED: Created duplicate version! {ts1} != {ts2}")
            return
            
        # 3. Create version 2 
        print("Creating version 2...")
        ts3 = create_version(test_file, f"{unique_str}Updated\n", {"summary": "v2 update"})
        
        # 4. Create version 3
        print("Creating version 3...")
        ts4 = create_version(test_file, f"{unique_str}Updated\nAgain\n", {"summary": "v3 update"})
        
        # 5. Create version 4
        print("Creating version 4...")
        ts5 = create_version(test_file, f"{unique_str}Updated\nAgain\nAnd Again\n", {"summary": "v4 update"})
        
        # 6. Verify parent chain and storage types
        versions = get_versions(test_file)
        
        print("\nVerifying version index:")
        for v in versions:
            print(f"v{v['version']}: parent={v['parent']}, storage={v['storage_type']}, id={v['version_id']}")
            
        v_dict = {v["version"]: v for v in versions}
        
        assert v_dict[1]["storage_type"] == "full", f"v1 must be full, got {v_dict[1]['storage_type']}"
        assert v_dict[1]["parent"] is None, "v1 parent must be None"
        
        assert v_dict[2]["storage_type"] == "diff", "v2 must be diff"
        assert v_dict[2]["parent"] == 1, "v2 parent must be 1"
        
        assert v_dict[3]["storage_type"] == "diff", "v3 must be diff"
        assert v_dict[3]["parent"] == 2, "v3 parent must be 2"
        
        assert v_dict[4]["storage_type"] == "full", "v4 must be full"
        assert v_dict[4]["parent"] == 3, "v4 parent must be 3"
        
        print("\nALL TESTS PASSED!")
        
    finally:
        if os.path.exists(test_file):
            os.remove(test_file)
        if os.path.exists(index_path):
            os.remove(index_path)

if __name__ == "__main__":
    run()
