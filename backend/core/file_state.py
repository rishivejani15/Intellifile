import os
from core.db import get_connection

def get_file_state(cursor, path, current_mtime):
    """
    Returns : 
    - ("new", None)
    - ("modified", file_id)
    - ("unchanged", file_id)
    """
    
    cursor.execute(
        "SELECT id,modified_time FROM files WHERE path=?",
        (path,)
    )
    row = cursor.fetchone()
    
    if row is None:
        return "new",None
    
    file_id,old_mtime = row
    
    if old_mtime != current_mtime:
        return "modified",file_id
    
    return "unchanged",file_id
    