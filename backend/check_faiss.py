import faiss
import os
import numpy as np

index_path = os.path.join(os.path.dirname(__file__), "..", "data", "vectors.faiss")

if not os.path.exists(index_path):
    print("Index not found.")
else:
    index = faiss.read_index(index_path)
    print(f"Index size: {index.ntotal}")
    
    # Extract IDs if possible. 
    # For IndexIDMap2, we can access .id_map
    # But id_map returns a std::vector which might not be directly exposed as list in python bindings easily without iteration or specific properties.
    # Actually, direct access might be via index.id_map (which is an std::vector<long>)
    # Let's try to simulate checking existence of IDs.
    
    # Try reconstructing
    try:
        # id_map is usually not directly exposed as a numpy array in all versions.
        # But we can try relying on remove_ids to test existence or search.
        pass
    except:
        pass

    # A better way is to see if we can get the IDs.
    # index.make_direct_map() allow access?
    
    # Or just search for each ID we expect (1..9) logic.
    ids_to_check = range(1, 15)
    print("Checking IDs 1..14:")
    for id_val in ids_to_check:
        # We can't easily check containment without reconstructing.
        # But we can reconstruct from the file if we really wanted to.
        # Let's just trust ntotal for now.
        pass

    # Actually, for IndexIDMap, we can sometimes access the IDs.
    # Let's try `faiss.vector_to_array(index.id_map)`
    try:
        ids = faiss.vector_to_array(index.id_map)
        print("IDs in index:", ids)
    except Exception as e:
        print(f"Could not retrieve IDs directly: {e}")
