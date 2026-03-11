import os
from core.db import get_connection

def get_file_state(path):
    """
    Returns : 
    - ("new", None)
    - ("modified", file_id)
    - ("unchanged", file_id)
    """
    
    conn = get_connection()
    cur = conn.cursor()
    
    cur.execute(
        "SELECT id,modified_time FROM files WHERE path=?",
        (path,)
    )
    row = cur.fetchone()
    
    current_mtime = int(os.path.getmtime(path))
    
    if row is None:
        conn.close()
        return "new",None
    
    file_id,old_mtime = row
    
    if old_mtime != current_mtime:
        conn.close()
        return "modified",file_id
    
    conn.close()
    return "unchanged",file_id
    